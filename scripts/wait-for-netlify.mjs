// Wait for Netlify to finish deploying one commit, and exit with its verdict.
//
// The rules deploy and the site deploy are two systems that answer to the same
// push and neither has ever known about the other. This is what joins them into
// one signal: after .github/workflows/deploy.yml publishes firestore.rules, it
// waits here for Netlify's own build of the same commit, so a single Actions run
// is green or red for the whole release rather than for half of it.
//
// It watches; it does not trigger. Netlify's git integration still starts the
// build, and must keep doing so — the site's `stop_builds` setting has to stay
// OFF or nothing builds at all. Triggering from here would have meant turning
// Netlify's build system off and moving the build into CI, which is a far larger
// change than joining up two signals.
//
// Ordering falls out of the timings rather than an interlock: publishing rules
// takes seconds and a site build takes minutes, so the rules are live well
// before the code that depends on them. That is the safe direction for a change
// that WIDENS what the rules allow. A change that tightens them wants two
// merges — code first, rules second — for reasons the workflow header explains.

const API = "https://api.netlify.com/api/v1";

const token = process.env.NETLIFY_AUTH_TOKEN;
const siteId = process.env.NETLIFY_SITE_ID;
const sha = process.env.COMMIT_SHA;

// Netlify's webhook and this job are started by the same push, so for the first
// stretch there is legitimately no deploy to find yet. Waiting for one to appear
// and waiting for one to finish are separate deadlines because they are separate
// diagnoses: "Netlify never heard about this commit" is a broken integration,
// "the deploy failed" is a broken build, and one error message for both would
// send you to the wrong place.
const APPEAR_TIMEOUT_MS = 5 * 60 * 1000;
const FINISH_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_MS = 15 * 1000;

// The one state that means success and the one that means failure, matched
// explicitly. Netlify's OpenAPI spec types `state` as a bare string with no
// enumeration, so anything else is treated as still in progress rather than
// guessed at from a list of names this file cannot verify.
const DONE = "ready";
const FAILED = "error";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  // The ::error:: prefix is what puts a line in the Actions run summary rather
  // than only in the log, where a failure at minute nineteen goes unread.
  console.log(`::error::${message}`);
  process.exit(1);
}

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

// The production deploy of this exact commit, and not one that merely looks
// like it. Three conditions, and the third is the one learned the hard way.
//
// commit_ref and context are the obvious pair: a single commit can carry several
// deploys — a branch deploy, a preview from the pull request it merged — and the
// release is the one that reaches the public site.
//
// createdAfter is the guard. On the first real run this matched a deploy raised
// a quarter of an hour BEFORE the push it was supposed to be waiting for, and
// reported the release live in under a second. A deploy of a commit cannot
// predate the commit, so anything older than this run is something else wearing
// the same fields, and a wait that answers instantly is not a wait. Whatever
// produced it — a re-run, a rebuild of an earlier deploy carrying the reference
// forward — the run went green without ever watching a build, which is worse
// than going red.
//
// The slack is for clock skew between this runner and Netlify's records only. It
// is deliberately small: its whole job is to be narrower than the fifteen-minute
// gap that exposed this.
const CREATED_SLACK_MS = 2 * 60 * 1000;

async function findDeploy(createdAfter) {
  const deploys = await api(`/sites/${siteId}/deploys?per_page=50`);
  const forCommit = deploys.filter((d) => d.commit_ref === sha && d.context === "production");

  // Logged before the age filter, and logged whether or not anything survives
  // it: the previous version printed an id and a url and nothing else, so when
  // the match turned out to be wrong there was no way to see WHY from the run
  // that did it. These four fields are the entire question.
  for (const d of forCommit) {
    console.log(`  candidate ${d.id} — state=${d.state} created=${d.created_at} skipped=${Boolean(d.skipped)}`);
  }

  return forCommit.find((d) => new Date(d.created_at).getTime() >= createdAfter - CREATED_SLACK_MS) || null;
}

async function main() {
  if (!token || !siteId || !sha) {
    fail("NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID and COMMIT_SHA must all be set.");
  }

  const startedAt = Date.now();
  let deploy = null;

  while (!deploy) {
    deploy = await findDeploy(startedAt);
    if (deploy) break;
    if (Date.now() - startedAt > APPEAR_TIMEOUT_MS) {
      fail(`No Netlify production deploy appeared for ${sha} within ${APPEAR_TIMEOUT_MS / 60000} minutes. ` +
        `The rules deploy above succeeded — this is about the site. Check that the site's builds are not stopped ` +
        `and that its git integration is still connected.`);
    }
    console.log(`Waiting for Netlify to pick up ${sha.slice(0, 7)}…`);
    await sleep(POLL_MS);
  }

  console.log(`Watching Netlify deploy ${deploy.id} (created ${deploy.created_at}, state ${deploy.state}) — ` +
    `${deploy.admin_url || deploy.deploy_url || "(no url)"}`);
  // A build Netlify chose not to run leaves the previously published deploy in
  // place. Not a failure — there was nothing to do — but it means this commit's
  // code did not ship in this deploy, which is not what a green tick usually
  // promises, so it is said out loud rather than passed over.
  if (deploy.skipped) console.log("::warning::Netlify skipped this build; the previously published deploy is still live.");

  let state = deploy.state;
  while (state !== DONE && state !== FAILED) {
    if (Date.now() - startedAt > FINISH_TIMEOUT_MS) {
      fail(`Netlify deploy ${deploy.id} was still "${state}" after ${FINISH_TIMEOUT_MS / 60000} minutes. ` +
        `It may yet finish — this run gave up waiting, it did not cancel anything.`);
    }
    console.log(`  state: ${state}`);
    await sleep(POLL_MS);
    state = (await api(`/deploys/${deploy.id}`)).state;
  }

  if (state === FAILED) {
    const full = await api(`/deploys/${deploy.id}`);
    fail(`Netlify deploy ${deploy.id} failed: ${full.error_message || "no error message given"}`);
  }

  console.log(`Netlify deploy ${deploy.id} is live.`);
}

main().catch((e) => fail(e.message));

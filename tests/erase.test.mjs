// Run with: npm test
//
// Erasure is the one operation in this system that takes data away, and the
// three things that make it correct are all invisible from the endpoints that
// call it: WHICH collections it reaches, the ORDER of its two phases, and the
// fact that a restore afterwards does not put everything back. Plain node, no
// runner, no dependency — the same shape as backup.test.mjs beside it.
import {
  eraseUser, surveyUser, whitelistEmails, normalizeEmail,
  UID_COLLECTIONS, ErasePhaseError,
} from "../netlify/functions/_eraseUser.mjs";
import { mergePurchase, describeChange } from "../netlify/functions/_backup.mjs";
import { mergeProgress } from "../src/progress-merge.js";
import { previewErase, eraseUser as eraseUserApi } from "../src/admin-erase.js";

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};
const ok = (name, cond) => eq(name, Boolean(cond), true);

// ── A stand-in for the Admin SDK ────────────────────────────────────────────
//
// Enough of it to record what was asked for: every document a batch deleted, in
// order, and whether deleteUser ran before or after the commit.
function fakeAdmin({ docs = [], users = {}, failCommit = false, deleteUserError = null } = {}) {
  const present = new Set(docs);          // "collection/id"
  const log = [];                         // every mutation, in order
  const key = (c, id) => `${c}/${id}`;

  const db = {
    collection: (c) => ({ doc: (id) => ({ _key: key(c, id), get: async () => ({ exists: present.has(key(c, id)) }) }) }),
    getAll: async (...refs) => refs.map((r) => ({ exists: present.has(r._key) })),
    batch: () => {
      const pending = [];
      return {
        delete: (ref) => pending.push(ref._key),
        commit: async () => {
          if (failCommit) throw new Error("commit blew up");
          for (const k of pending) { present.delete(k); log.push(`delete ${k}`); }
        },
      };
    },
  };

  const auth = {
    getUser: async (uid) => { if (!users[uid]) { const e = new Error("no user"); e.code = "auth/user-not-found"; throw e; } return users[uid]; },
    getUserByEmail: async (email) => {
      const found = Object.values(users).find((u) => normalizeEmail(u.email) === normalizeEmail(email));
      if (!found) { const e = new Error("no user"); e.code = "auth/user-not-found"; throw e; }
      return found;
    },
    deleteUser: async (uid) => {
      if (deleteUserError) throw deleteUserError;
      if (!users[uid]) { const e = new Error("no user"); e.code = "auth/user-not-found"; throw e; }
      delete users[uid];
      log.push(`deleteUser ${uid}`);
    },
  };

  return { admin: { auth: () => auth, firestore: () => db }, log, present };
}

// ── The addresses a wipe has to clear ───────────────────────────────────────
//
// adWhitelist is keyed by ADDRESS, not uid, and an account can hold more than
// one. Miss the provider's copy and somebody who asked to be erased keeps a
// whitelist entry — invisible, and enough to identify them.
eq("whitelist addresses: primary plus provider, normalized and deduped",
  whitelistEmails({ email: "Ada@Example.com ", providerData: [{ email: "ada@example.com" }, { email: "ADA@work.example" }] }),
  ["ada@example.com", "ada@work.example"]);

eq("whitelist addresses: a provider with no address contributes nothing",
  whitelistEmails({ email: "ada@example.com", providerData: [{ email: null }, {}] }),
  ["ada@example.com"]);

eq("whitelist addresses: no auth record at all", whitelistEmails(null), []);

// The client writes these ids with src/firebase.js -> normalizeEmail. Same rule
// here, or the entry survives the wipe.
eq("normalizeEmail matches the client's rule", normalizeEmail("  Ada@Example.COM "), "ada@example.com");

// ── What a wipe reaches, and in what order ──────────────────────────────────

{
  const { admin, log } = fakeAdmin({
    docs: ["users/u1", "highWater/u1", "purchaseLedger/u1", "adWhitelist/ada@example.com"],
    users: { u1: { uid: "u1", email: "ada@example.com" } },
  });
  await eraseUser({ uid: "u1", emails: ["ada@example.com"], admin });

  eq("every per-uid collection is deleted, and the whitelist entry with it", log, [
    "delete users/u1",
    "delete highWater/u1",
    "delete purchaseLedger/u1",
    "delete adWhitelist/ada@example.com",
    "deleteUser u1",
  ]);
  // Stated as its own assertion rather than left implicit in the array above:
  // documents first, auth user last. The other order orphans the documents
  // under a uid that can never sign in again to retry.
  ok("the auth user goes last", log[log.length - 1] === "deleteUser u1");
  ok("nothing is deleted twice", new Set(log).size === log.length);
}

{
  // A collection added to UID_COLLECTIONS later must be wiped without anybody
  // remembering to update an endpoint. This fails if one is added and this
  // module's loop is not what does the deleting.
  const { admin, log } = fakeAdmin({ users: { u1: { uid: "u1" } } });
  await eraseUser({ uid: "u1", admin });
  eq("the loop covers UID_COLLECTIONS, whatever is in it",
    log.filter((l) => l.startsWith("delete ")),
    UID_COLLECTIONS.map((c) => `delete ${c}/u1`));
}

{
  // Deleting an absent document is a no-op, which is what makes a retry after a
  // partial failure safe. No existence check anywhere in eraseUser.
  const { admin } = fakeAdmin({ users: { u1: { uid: "u1" } } });
  const result = await eraseUser({ uid: "u1", emails: ["gone@example.com", "", " Gone@Example.com "], admin });
  eq("addresses are normalized and deduped before they become document ids", result.emails, ["gone@example.com"]);
}

{
  // The retry case: the batch succeeded last time, the auth delete did not, and
  // the whole thing is run again. The second run must report success.
  const { admin } = fakeAdmin({ users: {} });
  let threw = null;
  try { await eraseUser({ uid: "orphan", admin }); } catch (e) { threw = e; }
  eq("an already-deleted auth user is success, not a failure", threw, null);
}

{
  const { admin, present } = fakeAdmin({ docs: ["users/u1"], users: { u1: { uid: "u1" } }, failCommit: true });
  let err = null;
  try { await eraseUser({ uid: "u1", admin }); } catch (e) { err = e; }
  eq("a failed batch reports the data phase", err?.phase, "data");
  ok("...as an ErasePhaseError", err instanceof ErasePhaseError);
  // "Nothing was removed" is what delete-account.mjs tells the user here, and it
  // has to be true: the batch is atomic and the auth user is untouched.
  ok("...and nothing was removed", present.has("users/u1"));
}

{
  const { admin, present } = fakeAdmin({
    docs: ["users/u1"], users: { u1: { uid: "u1" } },
    deleteUserError: Object.assign(new Error("nope"), { code: "auth/internal-error" }),
  });
  let err = null;
  try { await eraseUser({ uid: "u1", admin }); } catch (e) { err = e; }
  eq("a failed auth delete reports the auth phase", err?.phase, "auth");
  ok("...as an ErasePhaseError", err instanceof ErasePhaseError);
  // The opposite message: the data IS gone, and the endpoint must not imply
  // otherwise just because the call ended in an error.
  ok("...and the documents are already gone", !present.has("users/u1"));
}

// ── Looking an account up without touching it ───────────────────────────────

{
  const { admin, log } = fakeAdmin({
    docs: ["users/u1", "purchaseLedger/u1", "adWhitelist/ada@example.com"],
    users: { u1: { uid: "u1", email: "Ada@Example.com", providerData: [{ email: "ada@example.com" }] } },
  });
  const found = await surveyUser({ email: "ADA@example.com ", admin });
  eq("a look-up by address resolves the uid", found.uid, "u1");
  eq("...reports the address normalized", found.email, "ada@example.com");
  eq("...and reports exactly which documents exist",
    found.found, { users: true, highWater: false, purchaseLedger: true, adWhitelist: ["ada@example.com"] });
  eq("a look-up deletes nothing", log, []);
}

{
  // Documents orphaned by an interrupted erasure are precisely what somebody
  // would come here to clean up. Refusing to look at them would make this the
  // one tool that cannot finish its own job.
  const { admin } = fakeAdmin({ docs: ["highWater/ghost"], users: {} });
  const found = await surveyUser({ uid: "ghost", admin });
  eq("a uid with no auth user still surveys", { authUser: found.authUser, hw: found.found.highWater }, { authUser: false, hw: true });
  eq("...with no addresses to clear", found.emails, []);
}

// ── The interaction that would undo the whole feature ───────────────────────
//
// highWater/{uid} and purchaseLedger/{uid} exist so that progress and purchases
// survive damage to users/{uid}, and admin-restore.mjs merges them back. If an
// erasure left either behind, the next restore would resurrect the account; if
// the restore wrote a document for an account with nothing left anywhere, it
// would resurrect it even after a complete erasure.
//
// It does not, and that is a property of mergeProgress and describeChange
// rather than of anything a reader of admin-restore.mjs can see — so it is
// pinned here. This is the assertion that fails if either is ever changed to
// return a starter deck for empty input.
{
  const live = {};                                        // users/{uid} is gone
  const merged = { ...mergePurchase(live, {}), progress: mergeProgress(undefined, null, "erased") };
  eq("a restore of an erased account has nothing to merge", merged.progress, null);
  eq("...reports no change, so the endpoint returns before writing",
    describeChange(live, merged).changed, false);
  eq("...and does not hand back Pro", merged.adsRemoved, false);
}

// ── The client half ─────────────────────────────────────────────────────────

{
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ uid: "u1", erased: !JSON.parse(opts.body).dryRun }) };
  };

  await previewErase("tok", { email: "ada@example.com" });
  eq("preview asks for a dry run", calls[0].body, { email: "ada@example.com", dryRun: true });

  await eraseUserApi("tok", { uid: "u1" });
  eq("erase asks for the real thing, by uid", calls[1].body, { uid: "u1", dryRun: false });
  eq("both go to the admin endpoint",
    [...new Set(calls.map((c) => c.url))], ["/.netlify/functions/admin-erase-user"]);
}

{
  // The server's reason is the useful one — "That account is an administrator",
  // "No account with that email address" — so it must reach the panel rather
  // than being flattened into a status code.
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: "That account is an administrator." }) });
  let message = null;
  try { await eraseUserApi("tok", { uid: "u1" }); } catch (e) { message = e.message; }
  eq("the server's refusal reaches the caller", message, "That account is an administrator.");
}

console.log(fail ? `\n${fail} failing` : "\nAll erase tests passed");
process.exit(fail ? 1 : 0);

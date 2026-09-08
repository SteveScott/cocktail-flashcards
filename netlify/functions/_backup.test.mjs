// Run with: npm run test:backup
//
// The merge rules are the whole safety argument for the restore endpoint --
// that it can only ever add, and that a purchase can never be lost to a stale
// file -- so they get a regression guard even though the project carries no
// test framework. Plain node, no runner, no dependency.
import { mergeProgress, mergePurchase, describeChange, validateBackup, BACKUP_FORMAT }
  from "./_backup.mjs";

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};

// ── purchases are monotonic: the whole point ────────────────────────────────
eq("live Play-only, backup silent -> stays Pro",
  mergePurchase({ adsRemovedStripe: false, adsRemovedPlay: true, adsRemoved: true, adsRemovedAt: 200 }, {}),
  { adsRemovedStripe: false, adsRemovedPlay: true, adsRemoved: true, adsRemovedAt: 200 });

eq("stale backup says not-Pro -> still Pro",
  mergePurchase({ adsRemovedStripe: true, adsRemovedPlay: false, adsRemoved: true, adsRemovedAt: 200 },
                { adsRemovedStripe: false, adsRemovedPlay: false, adsRemoved: false }),
  { adsRemovedStripe: true, adsRemovedPlay: false, adsRemoved: true, adsRemovedAt: 200 });

eq("destroyed record, legacy Stripe grant in backup -> restored",
  mergePurchase({}, { adsRemoved: true, adsRemovedAt: 100, stripeSessionId: "cs_1" }),
  { adsRemovedStripe: true, adsRemovedPlay: false, adsRemoved: true, adsRemovedAt: 100, stripeSessionId: "cs_1" });

eq("two sources, two moments -> both kept, earliest stamp",
  mergePurchase({ adsRemovedStripe: true, adsRemovedPlay: false, adsRemoved: true, adsRemovedAt: 500 },
                { adsRemovedStripe: false, adsRemovedPlay: true, adsRemoved: true, adsRemovedAt: 100 }),
  { adsRemovedStripe: true, adsRemovedPlay: true, adsRemoved: true, adsRemovedAt: 100 });

eq("live reference wins, backup fills the blank",
  mergePurchase({ adsRemovedStripe: true, adsRemovedPlay: false, adsRemoved: true, adsRemovedAt: 1, stripeSessionId: "cs_new" },
                { adsRemovedStripe: true, adsRemovedPlay: false, adsRemoved: true, stripeSessionId: "cs_old", revenueCatEventId: "rc_1" }),
  { adsRemovedStripe: true, adsRemovedPlay: false, adsRemoved: true, adsRemovedAt: 1, stripeSessionId: "cs_new", revenueCatEventId: "rc_1" });

eq("no purchase either side -> no entitlement invented",
  mergePurchase({ adsRemovedStripe: false, adsRemovedPlay: false, adsRemoved: false }, {}),
  { adsRemovedStripe: false, adsRemovedPlay: false, adsRemoved: false });

// ── progress: union and max, nothing lost ──────────────────────────────────
const live   = { scores:{Negroni:2,Sidecar:5}, learned:["Sidecar"], tried:["A"], active:["Negroni"], deckSize:20 };
const backup = { scores:{Negroni:6,Daiquiri:1}, learned:["Negroni"], tried:["B"], active:["Daiquiri"], masterMode:true, deckSize:40 };
const m = mergeProgress(live, backup, "u1");
eq("scores take the max", m.scores, { Negroni:6, Sidecar:5, Daiquiri:1 });
eq("learned unions", m.learned.sort(), ["Negroni","Sidecar"]);
eq("tried unions", m.tried.sort(), ["A","B"]);
eq("mastered cards leave the deck", m.active, ["Daiquiri"]);
eq("masterMode is OR-ed", m.masterMode, true);
eq("deckSize keeps the live preference", m.deckSize, 20);

eq("empty live, full backup -> full restore", mergeProgress(null, backup, "u1").scores, { Negroni:6, Daiquiri:1 });
eq("full live, empty backup -> untouched", mergeProgress(live, null, "u1").scores, { Negroni:2, Sidecar:5 });

// Running a restore twice must land in the same place as running it once.
eq("idempotent", mergeProgress(m, backup, "u1"), m);

// Nothing a merge produces may ever be smaller than what was already live.
const shrank = Object.entries(live.scores).some(([k,v]) => (m.scores[k]||0) < v)
  || live.learned.some(n => !m.learned.includes(n))
  || live.tried.some(n => !m.tried.includes(n));
eq("no live value ever shrinks", shrank, false);

// ── summary + validation ───────────────────────────────────────────────────
eq("dry run counts additions",
  describeChange({ progress: live }, { progress: m, adsRemoved: true }),
  { learnedAdded:1, triedAdded:1, deckAdded:0, scoresRaised:2, proRestored:true, changed:true });
eq("no-op reports no change",
  describeChange({ progress: m, adsRemoved: false }, { progress: m, adsRemoved: false }).changed, false);

for (const [name, bad] of [["not json", null], ["wrong format", {format:"other"}],
                           ["future version", {format:BACKUP_FORMAT, version:99}],
                           ["no users", {format:BACKUP_FORMAT, version:1}]]) {
  let threw = false;
  try { validateBackup(bad); } catch { threw = true; }
  eq(`rejects ${name}`, threw, true);
}

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

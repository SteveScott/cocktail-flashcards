// Run with: npm test
//
// Drives the real client half (src/admin-restore.js) against a fake Firestore
// and the real merge rules, over enough accounts that the server's cursor
// paging engages. No file exists anywhere in this test, on purpose: the
// scenario is the one the feature exists for -- an account peaks, is wiped,
// and is restored straight from what was already sitting in Firestore.
import { restoreProgress } from "../../src/admin-restore.js";
import { mergePurchase, describeChange } from "./_backup.mjs";
import { mergeProgress } from "../../src/progress-merge.js";

// A fake Firestore: three collections, as in the real thing.
//   users           the current state -- follows a wipe wherever it goes
//   highWater       progress only, raised on every save, never lowered
//   purchaseLedger  purchase fields only, written in lockstep with `users`
//                   by every entitlement change -- see grantEntitlement()
const db = new Map();        // users/{uid}
const marks = new Map();     // highWater/{uid} -> progress
const ledger = new Map();    // purchaseLedger/{uid}
const emailToUid = new Map();

// What the app does on every save (App.jsx -> saveHighWater).
const save = (uid, progress) => {
  db.set(uid, { ...db.get(uid), progress });
  marks.set(uid, mergeProgress(marks.get(uid), progress, uid));
};

// What setSourceEntitlement does on every purchase, refund or transfer: writes
// the identical update to users/{uid} and purchaseLedger/{uid} at once, so the
// two can never drift apart in normal operation.
const grantEntitlement = (uid, stripe, play, extra = {}) => {
  const adsRemoved = stripe || play;
  const update = { adsRemovedStripe: stripe, adsRemovedPlay: play, adsRemoved, ...extra };
  db.set(uid, { ...db.get(uid), ...update });
  ledger.set(uid, { ...ledger.get(uid), ...update });
};

// 250 accounts, so the server's 100-per-page cursor engages more than once.
for (let i = 0; i < 250; i++) {
  const uid = `u${i}`;
  emailToUid.set(`${uid}@example.com`, uid);
  db.set(uid, { updatedAt: i });
  save(uid, { scores: { Negroni: i % 7 }, learned: i % 3 ? [] : ["Negroni"], tried: [], active: ["Sidecar"], deckSize: 20 });
  if (i % 50 === 0) grantEntitlement(uid, true, false, { adsRemovedAt: 1000 + i });
}

// The fake admin-restore.mjs: same shape as the real endpoint (cursor over
// `users`, uid/email lookup, per-account merge, write only on a real change),
// reading the same three maps a real deploy would read from Firestore.
const PAGE = 100;
global.fetch = async (_url, opts) => {
  const { uid, email, cursor, dryRun } = JSON.parse(opts.body);
  const ok = (o) => ({ ok: true, status: 200, json: async () => o });

  let targetUids, nextCursor;
  const wanted = (email || "").toLowerCase();
  if (uid || wanted) {
    const resolved = uid || emailToUid.get(wanted);
    if (!resolved) return { ok: false, status: 404, json: async () => ({ error: "No account with that email address." }) };
    targetUids = [resolved];
  } else {
    const ids = [...db.keys()].sort();
    const start = cursor ? ids.indexOf(cursor) + 1 : 0;
    targetUids = ids.slice(start, start + PAGE);
    if (start + PAGE < ids.length) nextCursor = targetUids[targetUids.length - 1];
  }

  const results = [];
  for (const targetUid of targetUids) {
    const live = db.get(targetUid) || {};
    const merged = {
      ...mergePurchase(live, ledger.get(targetUid) || {}),
      progress: mergeProgress(live.progress, marks.get(targetUid) || null, targetUid),
    };
    const delta = describeChange(live, merged);
    if (delta.changed && !dryRun) db.set(targetUid, { ...live, ...merged, restoredAt: Date.now() });
    results.push({ uid: targetUid, email: `${targetUid}@example.com`, ...delta });
  }

  const changed = results.filter((r) => r.changed);
  return ok({
    dryRun, examined: results.length, changed: changed.length,
    proRestored: results.filter((r) => r.proRestored).length,
    details: changed,
    ...(nextCursor ? { nextCursor } : {}),
  });
};

let fail = 0;
const eq = (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) { fail++; console.log(`FAIL ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`); } else console.log(`ok   ${n}`); };

// 0. The case this design exists for. u1 peaks, then is wiped -- and needs no
//    file, no download, no schedule for the peak to survive: it is read
//    straight back out of highWater the moment a restore runs.
save("u1", { scores: { Negroni: 6, Sidecar: 6 }, learned: ["Negroni", "Sidecar"], tried: ["A"], active: [], deckSize: 20 });
save("u1", { scores: {}, learned: [], tried: [], active: [], deckSize: 20 });   // wiped
eq("the live document followed the wipe down", db.get("u1").progress.learned, []);
eq("the mark did not", marks.get("u1").learned, ["Negroni", "Sidecar"]);

const u1Preview = await restoreProgress("tok", { uid: "u1", dryRun: true });
eq("preview finds the peak without writing", [u1Preview.changed, db.get("u1").progress.learned], [1, []]);
await restoreProgress("tok", { uid: "u1" });
eq("u1 restored to its peak, live document included, no file anywhere", db.get("u1").progress.learned, ["Negroni", "Sidecar"]);

// 1. A purchase survives even the whole users/{uid} document disappearing --
//    not just its fields being wiped, the document itself gone -- because the
//    ledger is a second collection entirely, not a second field on the same one.
db.delete("u100");
eq("the account is fully gone from `users`", db.has("u100"), false);
eq("the ledger does not need it to exist", ledger.get("u100").adsRemoved, true);
await restoreProgress("tok", { uid: "u100" });
eq("purchase recovered into a document that did not exist a moment ago", db.get("u100").adsRemoved, true);
eq("original grant date kept, not restamped to now", db.get("u100").adsRemovedAt, 1100);

// 2. Disaster: progress wiped and Pro lost across the board.
for (const [id, d] of db) {
  db.set(id, { ...d, adsRemovedStripe: false, adsRemoved: false,
                progress: { scores: {}, learned: [], tried: [], active: [], deckSize: 20 } });
}

// 3. Preview writes nothing.
const preview = await restoreProgress("tok", { dryRun: true });
eq("preview examines every account, paging past 100 on its own", preview.examined, 250);
eq("preview still shows nothing written", db.get("u0").adsRemoved, false);
eq("preview finds every lost Pro account", preview.proRestored, 5);

// 4. Real restore, all accounts, no uid or email given.
const done = await restoreProgress("tok", {});
eq("restore examined everyone", done.examined, 250);
eq("Pro restored for all 5", done.proRestored, 5);
eq("progress back", db.get("u3").progress.scores.Negroni, 3);
eq("learned back", db.get("u0").progress.learned, ["Negroni"]);
eq("purchase back", db.get("u50").adsRemoved, true);

// 5. Re-running changes nothing (idempotent).
const again = await restoreProgress("tok", {});
eq("second run is a no-op", again.changed, 0);

// 6. A purchase made AFTER the last restore is never revoked by running it
//    again: the ledger is not a moment frozen in time, so there is no "stale
//    file" for a fresh purchase to be older than.
grantEntitlement("u7", false, true, { adsRemovedAt: 9999 });
await restoreProgress("tok", {});
eq("a purchase newer than the last restore survives running it again", db.get("u7").adsRemoved, true);

// 7. Restore one person by the address they wrote in from -- no uid needed.
db.set("u9", { ...db.get("u9"), progress: { scores: {}, learned: [], tried: [], active: [], deckSize: 20 } });
const one = await restoreProgress("tok", { email: "U9@Example.com" });
eq("individual restore touches exactly one account", one.examined, 1);
eq("that account is back", db.get("u9").progress.scores.Negroni, 2);
eq("and nobody else moved", (await restoreProgress("tok", {})).changed, 0);

// 8. An address nobody signed up with is a clear error, not a silent no-op.
let threw = false;
try { await restoreProgress("tok", { email: "nobody@example.com" }); } catch { threw = true; }
eq("an unknown email is rejected rather than examining nothing", threw, true);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

// Run with: npm test
//
// Drives the real client half (src/admin-backup.js) against a fake Firestore
// and the real merge rules, over enough accounts that paging and chunking both
// engage. The scenario is the one the feature exists for: progress wiped and
// purchases lost across the board, then restored from a file taken before it.
import { fetchBackup, restoreBackup } from "../../src/admin-backup.js";
import { mergeProgress, mergePurchase, describeChange, BACKUP_FORMAT, BACKUP_VERSION }
  from "./_backup.mjs";

// A fake Firestore: 250 accounts, so paging (100/page) and chunking both engage.
const db = new Map();
for (let i = 0; i < 250; i++) {
  db.set(`u${i}`, {
    updatedAt: i,
    adsRemovedStripe: i % 50 === 0, adsRemovedPlay: false, adsRemoved: i % 50 === 0,
    ...(i % 50 === 0 ? { adsRemovedAt: 1000 + i } : {}),
    progress: { scores: { Negroni: i % 7 }, learned: i % 3 ? [] : ["Negroni"], tried: [], active: ["Sidecar"], deckSize: 20 },
  });
}
const PAGE = 100;

global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const ok = (o) => ({ ok: true, status: 200, json: async () => o });

  if (url.endsWith("admin-backup")) {
    const ids = [...db.keys()].sort();
    const start = body.cursor ? ids.indexOf(body.cursor) + 1 : 0;
    const page = ids.slice(start, start + PAGE);
    return ok({
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(),
      users: page.map((uid) => {
        const d = db.get(uid);
        const { progress, updatedAt, ...purchase } = d;
        return { uid, email: `${uid}@example.com`, updatedAt, purchase, progress };
      }),
      ...(body.cursor ? {} : { adWhitelist: [{ email: "comped@example.com", addedAt: 1 }] }),
      ...(page.length === PAGE ? { nextCursor: page[page.length - 1] } : {}),
    });
  }

  // The restore endpoint's merge, verbatim from _backup.mjs.
  const { backup, uid, email, dryRun } = body;
  const want = (email || "").toLowerCase();
  const targets = (uid || want)
    ? backup.users.filter((u) => u.uid === uid || (u.email || "").toLowerCase() === want)
    : backup.users;
  const details = [];
  for (const e of targets) {
    const live = db.get(e.uid) || {};
    const merged = { ...mergePurchase(live, e.purchase || {}), progress: mergeProgress(live.progress, e.progress, e.uid) };
    const delta = describeChange(live, merged);
    if (delta.changed && !dryRun) db.set(e.uid, { ...live, ...merged });
    if (delta.changed) details.push({ uid: e.uid, email: e.email, ...delta });
  }
  return ok({ dryRun, examined: targets.length, changed: details.length,
              proRestored: details.filter((d) => d.proRestored).length,
              whitelistRestored: (backup.adWhitelist || []).length, details });
};

let fail = 0;
const eq = (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) { fail++; console.log(`FAIL ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`); } else console.log(`ok   ${n}`); };

// 1. Export stitches all three pages into one file.
const backup = await fetchBackup("tok");
eq("paged export returns every account", backup.users.length, 250);
eq("counts computed", backup.counts, { users: 250, adWhitelist: 1 });
eq("no cursor left in the file", backup.nextCursor, undefined);
eq("whitelist carried once", backup.adWhitelist.length, 1);

// 2. Disaster: progress wiped and Pro lost across the board.
for (const [uid, d] of db) {
  db.set(uid, { ...d, adsRemovedStripe: false, adsRemoved: false,
                progress: { scores: {}, learned: [], tried: [], active: [], deckSize: 20 } });
}

// 3. Preview writes nothing.
const preview = await restoreBackup("tok", { backup, dryRun: true });
eq("preview examines everyone", preview.examined, 250);
eq("preview still shows nothing written", db.get("u0").adsRemoved, false);
eq("preview finds the lost Pro accounts", preview.proRestored, 5);

// 4. Real restore, in chunks.
const done = await restoreBackup("tok", { backup });
eq("restore examined everyone", done.examined, 250);
eq("Pro restored for all 5", done.proRestored, 5);
eq("progress back", db.get("u3").progress.scores.Negroni, 3);
eq("learned back", db.get("u0").progress.learned, ["Negroni"]);
eq("purchase back", db.get("u50").adsRemoved, true);
eq("original grant date kept", db.get("u50").adsRemovedAt, 1050);

// 5. Re-running changes nothing (idempotent).
const again = await restoreBackup("tok", { backup });
eq("second run is a no-op", again.changed, 0);

// 6. A purchase made AFTER the backup survives restoring the old file.
db.set("u7", { ...db.get("u7"), adsRemovedPlay: true, adsRemoved: true, adsRemovedAt: 9999 });
await restoreBackup("tok", { backup });
eq("newer purchase not revoked by an older backup", db.get("u7").adsRemoved, true);

// 7. Restore one person by the address they wrote in from.
db.set("u9", { ...db.get("u9"), progress: { scores: {}, learned: [], tried: [], active: [], deckSize: 20 } });
const one = await restoreBackup("tok", { backup, email: "U9@Example.com" });
eq("individual restore touches one account", one.examined, 1);
eq("that account is back", db.get("u9").progress.scores.Negroni, 2);
eq("and nobody else moved", (await restoreBackup("tok", { backup })).changed, 0);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

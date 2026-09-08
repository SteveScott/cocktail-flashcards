import { readFlag } from "./_entitlements.mjs";

// The backup file format, and the rules for folding one back into Firestore.
//
// ── One row per user, at their best ─────────────────────────────────────────
//
// This is not a snapshot of a moment. Every user carries a HIGH-WATER MARK in
// highWater/{uid}, which the app raises on every save and which can only ever
// grow (mergeProgress in src/backup-format.js, enforced again by
// firestore.rules). The export reads those marks, so the file holds each user
// at their maximum completed state — not at whatever state they happened to be
// in when the button was pressed.
//
// That is what makes the file date-independent. There is nothing to schedule
// and no window to miss: a wipe on Tuesday cannot lower Monday's peak, so a
// download on Wednesday still carries it. One file, always current, always the
// best each account has ever reached.
//
// ── The shape ───────────────────────────────────────────────────────────────
//
//   {
//     "format": "cocktail-flashcards/backup",
//     "version": 2,
//     "createdAt": "2026-09-08T13:04:11.912Z",   // when downloaded; not what it holds
//     "projectId": "cocktail-flashcards",
//     "counts": { "users": 412, "adWhitelist": 3 },
//     "users": [
//       {
//         "uid": "V1cVv…",
//         "email": "drinker@example.com",     // from Auth, for restoring one
//         "updatedAt": 1757340000000,          //   person by address
//         "purchase": {                        // what was PAID FOR — from
//           "adsRemoved": true,                //   users/{uid}, server-owned
//           "adsRemovedStripe": true,
//           "adsRemovedPlay": false,
//           "adsRemovedAt": 1756000000000,
//           "adsRemovedSource": "stripe",
//           "stripeSessionId": "cs_…",
//           "revenueCatEventId": null
//         },
//         "progress": {                        // what was EARNED — the
//           "scores": { "Negroni": 6 },        //   high-water mark
//           "learned": ["Negroni"],
//           "tried": ["Negroni", "Sazerac"],
//           "active": ["Sidecar", "Martini"],
//           "masterMode": true,
//           "deckSize": 20
//         }
//       }
//     ],
//     "adWhitelist": [{ "email": "comped@example.com", "addedAt": 1, "addedBy": "…" }]
//   }
//
// Purchase and progress are separate blocks, and they come from separate
// documents, because they are trusted differently. Progress is client-written,
// so a restore pushing it back into users/{uid} may only ever carry progress —
// were an entitlement to ride along in a document its owner can write, any user
// could grant themselves Pro by writing to their own mark and waiting for a
// restore. Purchases are therefore read from users/{uid}, which no client can
// write (firestore.rules), and merged under their own rule below.
//
// ── The one invariant ───────────────────────────────────────────────────────
//
// A restore only ever ADDS. No field is deleted, no number goes down, no true
// becomes false, no user disappears. That is what makes it safe to run against
// a live database, safe to run twice, and safe to run from a file older than
// the data already there — the worst a stale file can do is nothing. Every
// merge below has to preserve it.

// Shared with the browser half, which validates a file before uploading it and
// must not pull firebase-admin into the bundle to do so.
export { BACKUP_FORMAT, BACKUP_VERSION, mergeProgress } from "../../src/backup-format.js";
import { BACKUP_FORMAT, BACKUP_VERSION } from "../../src/backup-format.js";

// Everything on a user document that records a purchase rather than progress.
// `adsRemoved` is derived from the two source flags and is recomputed on every
// write (see _entitlements.mjs), so it is carried in the file for a human
// reading it but never trusted back out of one.
export const PURCHASE_FIELDS = [
  "adsRemoved",
  "adsRemovedStripe",
  "adsRemovedPlay",
  "adsRemovedAt",
  "adsRemovedSource",
  "stripeSessionId",
  "revenueCatEventId",
];

// Opaque references to the transaction that granted an entitlement. Not flags:
// they cannot be OR-ed, so a live value always wins and the backup only fills a
// blank. Overwriting a current Stripe session id with an older one would leave
// the document describing a purchase that has since been superseded.
const PURCHASE_REFS = ["adsRemovedSource", "stripeSessionId", "revenueCatEventId"];

const asArray = (v) => (Array.isArray(v) ? v : []);

// Pull the purchase block out of a live Firestore document.
export function purchaseOf(data = {}) {
  const out = {};
  for (const f of PURCHASE_FIELDS) if (data[f] !== undefined) out[f] = data[f];
  return out;
}

// Merge purchases, monotonically. An entitlement can only be turned ON here.
//
// This is the half of a restore that has to be got right. The file is a
// snapshot of some earlier moment: someone who bought Pro after it was taken
// must not lose it because the file says they hadn't yet, and someone whose
// record was destroyed must get it back from the file. Both fall out of OR-ing
// each source's own flag and recomputing the union, which is exactly what the
// webhooks do — a refund or expiry is theirs to write, never a restore's.
export function mergePurchase(liveData = {}, backupPurchase = {}) {
  const stripe = readFlag(liveData, "stripe") || readFlag(backupPurchase, "stripe");
  const play = readFlag(liveData, "play") || readFlag(backupPurchase, "play");
  const adsRemoved = stripe || play;

  const out = { adsRemovedStripe: stripe, adsRemovedPlay: play, adsRemoved };

  if (adsRemoved) {
    // The earliest grant either copy knows about: when someone has been Pro
    // since March, a restore should not restamp them as Pro since today.
    const stamps = [liveData.adsRemovedAt, backupPurchase.adsRemovedAt]
      .map(Number).filter((n) => Number.isFinite(n) && n > 0);
    out.adsRemovedAt = stamps.length ? Math.min(...stamps) : Date.now();
  }

  for (const ref of PURCHASE_REFS) {
    const value = liveData[ref] ?? backupPurchase[ref];
    if (value !== undefined && value !== null) out[ref] = value;
  }
  return out;
}

// What a restore would change for one user, for the dry run and the summary.
// Counts additions only, because additions are all a restore can make.
export function describeChange(liveData = {}, merged = {}) {
  const liveProgress = liveData.progress || {};
  const mergedProgress = merged.progress || {};
  const grew = (before, after) => Math.max(0, asArray(after).length - asArray(before).length);

  let scoresRaised = 0;
  for (const [name, value] of Object.entries(mergedProgress.scores || {})) {
    if ((Number(liveProgress.scores?.[name]) || 0) < (Number(value) || 0)) scoresRaised += 1;
  }

  const change = {
    learnedAdded: grew(liveProgress.learned, mergedProgress.learned),
    triedAdded: grew(liveProgress.tried, mergedProgress.tried),
    deckAdded: grew(liveProgress.active, mergedProgress.active),
    scoresRaised,
    // The headline: an account that had lost its purchase and is getting it back.
    proRestored: merged.adsRemoved === true && liveData.adsRemoved !== true,
  };
  change.changed =
    change.learnedAdded > 0 || change.triedAdded > 0 || change.deckAdded > 0 ||
    change.scoresRaised > 0 || change.proRestored;
  return change;
}

// Reject anything that is not one of our backups before a single document is
// touched. An operator who picks the wrong file should find out from an error,
// not from the summary afterwards.
export function validateBackup(backup) {
  if (!backup || typeof backup !== "object") throw new Error("That file is not a backup.");
  if (backup.format !== BACKUP_FORMAT) throw new Error("That file is not a Cocktail Flashcards backup.");
  // A v1 file (a point-in-time snapshot, before high-water marks) restores
  // perfectly well: the merge treats whatever it holds as one more lower bound.
  if (backup.version > BACKUP_VERSION) {
    throw new Error(`That backup was written by a newer version of the app (v${backup.version}). Update before restoring it.`);
  }
  if (!Array.isArray(backup.users)) throw new Error("That backup has no users in it.");
  return backup;
}

import { readFlag } from "./_entitlements.mjs";

// The backup file format, and the rules for folding one back into Firestore.
//
// ── The shape ───────────────────────────────────────────────────────────────
//
//   {
//     "format": "cocktail-flashcards/backup",
//     "version": 1,
//     "createdAt": "2026-09-08T13:04:11.912Z",
//     "projectId": "cocktail-flashcards",
//     "counts": { "users": 412, "adWhitelist": 3 },
//     "users": [
//       {
//         "uid": "V1cVv…",
//         "email": "drinker@example.com",     // from Auth, for restoring one
//         "updatedAt": 1757340000000,          //   person by address
//         "purchase": {                        // what was PAID FOR
//           "adsRemoved": true,
//           "adsRemovedStripe": true,
//           "adsRemovedPlay": false,
//           "adsRemovedAt": 1756000000000,
//           "adsRemovedSource": "stripe",
//           "stripeSessionId": "cs_…",
//           "revenueCatEventId": null
//         },
//         "progress": {                        // what was EARNED
//           "scores": { "Negroni": 6, "Sidecar": 2 },
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
// Purchase and progress are separate blocks rather than one flat document
// because they are restored under opposite rules, and splitting them puts that
// difference in the data where it can be read, instead of only in the code:
// progress is merged, purchases are never lowered.
//
// ── The one invariant ───────────────────────────────────────────────────────
//
// A restore only ever ADDS. No field is deleted, no number goes down, no true
// becomes false, no user disappears. That is what makes it safe to run against
// a live database, safe to run twice, and safe to run from a backup that is
// older than the data already there — the worst a stale file can do is nothing.
// Every merge below has to preserve it.

// Shared with the browser half, which validates a file before uploading it and
// must not pull firebase-admin into the bundle to do so.
export { BACKUP_FORMAT, BACKUP_VERSION } from "../../src/backup-format.js";
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

const DEFAULT_DECK_SIZE = 20;

const asArray = (v) => (Array.isArray(v) ? v : []);
const union = (a, b) => Array.from(new Set([...asArray(a), ...asArray(b)]));

// Pull the purchase block out of a live Firestore document.
export function purchaseOf(data = {}) {
  const out = {};
  for (const f of PURCHASE_FIELDS) if (data[f] !== undefined) out[f] = data[f];
  return out;
}

// Merge two progress states, taking the best of each: the higher score, the
// union of every list. This is the same rule App.jsx -> mergeStates() applies
// when it folds a device's progress into an account, for the same reason —
// having mastered a cocktail is a fact one copy of the data cannot un-know.
//
// `active` is left as the union rather than trimmed to a deck size. Only the
// client knows which cocktails the pool currently covers (the free top 50, or
// the whole book with Pro), and its refillDeck() cuts the deck back to size on
// the next load. Trimming here would mean guessing, and guessing low loses a
// card the user was studying.
export function mergeProgress(live, backup, uid) {
  const a = live || null;
  const b = backup || null;
  if (!a && !b) return null;

  const scores = { ...(a?.scores || {}) };
  for (const [name, value] of Object.entries(b?.scores || {})) {
    const n = Number(value) || 0;
    scores[name] = Math.max(Number(scores[name]) || 0, n);
  }

  const learned = union(a?.learned, b?.learned);
  const learnedSet = new Set(learned);

  return {
    scores,
    learned,
    tried: union(a?.tried, b?.tried),
    // A cocktail that has been mastered is not also still waiting in the deck.
    active: union(a?.active, b?.active).filter((n) => !learnedSet.has(n)),
    masterMode: Boolean(a?.masterMode || b?.masterMode),
    // A current preference rather than progress, so the live value wins and the
    // backup only supplies one where the document has none.
    deckSize: a?.deckSize || b?.deckSize || DEFAULT_DECK_SIZE,
    uid,
  };
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
  if (backup.version > BACKUP_VERSION) {
    throw new Error(`That backup was written by a newer version of the app (v${backup.version}). Update before restoring it.`);
  }
  if (!Array.isArray(backup.users)) throw new Error("That backup has no users in it.");
  return backup;
}

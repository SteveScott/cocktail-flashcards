import { readFlag } from "./_entitlements.mjs";

// The rules a restore folds back into Firestore — reading two collections that
// already live there, not a file.
//
// ── Two durable copies, not a snapshot ──────────────────────────────────────
//
// Every account's progress and purchases already exist twice in Firestore:
//
//   users/{uid}            the CURRENT state — what the app reads and writes
//   highWater/{uid}        progress only, and it can only ever GROW
//   purchaseLedger/{uid}   purchase fields only, mirrored in lockstep with
//                          users/{uid} by setSourceEntitlement — no client can
//                          reach it in either direction
//
// A restore reads the second and third and merges them into the first. There
// is no export step and nothing to download: the moment either half of a
// purchase or a mastered cocktail is written, it is already backed up, and
// admin-restore.mjs reads that live state at the moment it is asked to, not
// whatever a file happened to hold when it was taken. See
// docs/backup-restore.md for the full shape of both collections.
//
// ── The one invariant ───────────────────────────────────────────────────────
//
// A restore only ever ADDS. No field is deleted, no number goes down, no true
// becomes false, no user disappears. That is what makes it safe to run against
// a live database, safe to run twice, and — for the same reason a stale backup
// file used to be safe — safe even when highWater or purchaseLedger is behind
// users/{uid} in some way nobody anticipated. The worst either can do is
// nothing. Every merge below has to preserve it.

// Shared with the browser half, which raises the high-water mark on every save
// (App.jsx -> saveHighWater) using the same rule a restore merges it back with.
export { mergeProgress } from "../../src/progress-merge.js";

// Opaque references to the transaction that granted an entitlement. Not flags:
// they cannot be OR-ed, so the live value always wins and the ledger only fills
// a blank. Overwriting a current Stripe session id with an older one would leave
// the document describing a purchase that has since been superseded.
const PURCHASE_REFS = ["adsRemovedSource", "stripeSessionId", "revenueCatEventId"];

const asArray = (v) => (Array.isArray(v) ? v : []);

// Merge purchases, monotonically. An entitlement can only be turned ON here.
//
// This is the half of a restore that has to be got right. purchaseLedger can, in
// principle, be behind users/{uid} — a document written before the ledger
// existed, or one whose write raced a webhook — so someone who bought Pro since
// the ledger last reflected it must not lose it, and someone whose users/{uid}
// record was destroyed must get it back from the ledger. Both fall out of OR-ing
// each source's own flag and recomputing the union, which is exactly what the
// webhooks do — a refund or expiry is theirs to write, never a restore's.
export function mergePurchase(liveData = {}, ledgerData = {}) {
  const stripe = readFlag(liveData, "stripe") || readFlag(ledgerData, "stripe");
  const play = readFlag(liveData, "play") || readFlag(ledgerData, "play");
  const adsRemoved = stripe || play;

  const out = { adsRemovedStripe: stripe, adsRemovedPlay: play, adsRemoved };

  if (adsRemoved) {
    // The earliest grant either copy knows about: when someone has been Pro
    // since March, a restore should not restamp them as Pro since today.
    const stamps = [liveData.adsRemovedAt, ledgerData.adsRemovedAt]
      .map(Number).filter((n) => Number.isFinite(n) && n > 0);
    out.adsRemovedAt = stamps.length ? Math.min(...stamps) : Date.now();
  }

  for (const ref of PURCHASE_REFS) {
    const value = liveData[ref] ?? ledgerData[ref];
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

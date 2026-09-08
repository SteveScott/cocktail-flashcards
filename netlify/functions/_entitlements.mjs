import { getAdmin } from "./_firebaseAdmin.mjs";

// Ad removal can be granted by two independent payment systems: Stripe on the
// web and Google Play (via RevenueCat) in the Android app. They are separate
// purchases and neither speaks for the other.
//
// So each source owns its own flag, and `adsRemoved` — the single field clients
// read — is their union, recomputed on every write. Letting both webhooks write
// `adsRemoved` directly meant a Play REFUND, EXPIRATION, or source-side TRANSFER
// wrote false straight over a perfectly valid Stripe purchase, silently putting
// ads back for someone who had paid on the web.
//
//   adsRemovedStripe   granted by stripe-webhook.mjs
//   adsRemovedPlay     granted by revenuecat-webhook.mjs
//   adsRemoved         derived: stripe || play  (what the client reads)
const FIELD = { stripe: "adsRemovedStripe", play: "adsRemovedPlay" };

// Read one source's flag, accounting for documents written before the
// per-source split existed: those have `adsRemoved: true` and no source flags,
// and the Stripe webhook was the only thing that ever set it, so an unqualified
// legacy grant belongs to Stripe. Getting this wrong would revoke ad removal
// from everyone who bought on the web before the split.
//
// Exported because netlify/functions/_backup.mjs applies this same rule when a
// restore reads an old purchaseLedger entry: a second, drifting copy of it
// would risk the same wrong revocation from the other direction.
export function readFlag(data, source) {
  const explicit = data[FIELD[source]];
  if (typeof explicit === "boolean") return explicit;
  if (source === "stripe") return data.adsRemoved === true && data.adsRemovedSource !== "play";
  return false;
}

// Grant or revoke ad removal for ONE source, leaving the other untouched, and
// republish the union. Runs in a transaction because the two webhooks are
// independent and can land at the same time; a read-modify-write without one
// could drop whichever grant lost the race.
export async function setSourceEntitlement(uid, source, granted, meta = {}) {
  if (!FIELD[source]) throw new Error(`Unknown entitlement source: ${source}`);
  const db = getAdmin().firestore();
  const ref = db.collection("users").doc(uid);
  // A second, independent copy of the same purchase fields — see the write
  // below for why.
  const ledgerRef = db.collection("purchaseLedger").doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};

    const flags = { stripe: readFlag(data, "stripe"), play: readFlag(data, "play") };
    flags[source] = granted;
    const adsRemoved = flags.stripe || flags.play;

    const update = {
      adsRemovedStripe: flags.stripe,
      adsRemovedPlay: flags.play,
      adsRemoved,
      // Only meaningful while ad-free; left as the last granting source otherwise.
      ...(adsRemoved ? { adsRemovedAt: data.adsRemovedAt || Date.now() } : {}),
      ...meta,
    };

    tx.set(ref, update, { merge: true });
    // This is what "purchase history should never be lost" means in practice.
    // users/{uid} also carries this account's progress, written on every study
    // session, so it is not a document that only a rare event ever touches — and
    // a bug or a slip that damages it (the kind that emptied progress before
    // high-water marks existed; see docs/backup-restore.md) would take the
    // purchase down with it, with nothing anywhere to recover it from. Writing
    // the identical update into a second, client-unreachable collection, in the
    // same transaction so the two can never drift apart, is what gives a
    // restore something durable to read even if users/{uid} itself is gone.
    // firestore.rules denies every client read and write on purchaseLedger; only
    // this function, via the Admin SDK, ever touches it.
    tx.set(ledgerRef, update, { merge: true });
  });
}

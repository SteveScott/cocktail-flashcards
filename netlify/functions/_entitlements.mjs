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

// Read one source's flag, accounting for documents written before the per-source
// split existed. Those have `adsRemoved: true` and no source flags, and the
// Stripe webhook was the only thing that ever set it — so an unqualified legacy
// grant belongs to Stripe. Getting this wrong would revoke ad removal from
// everyone who bought on the web before this change.
function readFlag(data, source) {
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

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};

    const flags = { stripe: readFlag(data, "stripe"), play: readFlag(data, "play") };
    flags[source] = granted;
    const adsRemoved = flags.stripe || flags.play;

    tx.set(ref, {
      adsRemovedStripe: flags.stripe,
      adsRemovedPlay: flags.play,
      adsRemoved,
      // Only meaningful while ad-free; left as the last granting source otherwise.
      ...(adsRemoved ? { adsRemovedAt: data.adsRemovedAt || Date.now() } : {}),
      ...meta,
    }, { merge: true });
  });
}

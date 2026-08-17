import { timingSafeEqual } from "node:crypto";
import { getAdmin } from "./_firebaseAdmin.mjs";

// RevenueCat calls this endpoint directly when a Play Billing purchase changes
// state, which is how a purchase made in the Android app becomes visible to the
// web. Configure it in the RevenueCat dashboard under
// Project settings → Integrations → Webhooks:
//   URL:           https://<your-domain>/.netlify/functions/revenuecat-webhook
//   Authorization: the exact value of REVENUECAT_WEBHOOK_SECRET
//
// This mirrors stripe-webhook.mjs: the browser is never trusted to grant itself
// ad removal — only these server-side functions write `adsRemoved`, using the
// Admin SDK to bypass the security rules that keep clients read-only on it.
//
// The app-user id RevenueCat reports is the Firebase uid, because the app calls
// Purchases.logIn(uid) (see src/monetization.js). Purchases made before sign-in
// carry an anonymous id instead and are skipped — nothing maps them to an
// account, so they stay device-local until the user signs in and RevenueCat
// aliases them onto their uid (which arrives here as a TRANSFER event).
// Must match VITE_REVENUECAT_ENTITLEMENT in the client build.
const ENTITLEMENT = process.env.REVENUECAT_ENTITLEMENT || "cocktail_flashcards_pro";

// Purchase/ownership events that grant ad removal, and the ones that take it
// back (a refunded or expired purchase must not stay ad-free on the web).
const GRANT_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
]);
const REVOKE_EVENTS = new Set(["EXPIRATION", "REFUND"]);

// RevenueCat's anonymous ids can't be resolved to a Firebase account.
function isRealUid(id) {
  return Boolean(id) && typeof id === "string" && !id.startsWith("$RCAnonymousID:");
}

function secretMatches(provided, expected) {
  const a = Buffer.from(provided || "", "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch, so check that first.
  return a.length === b.length && timingSafeEqual(a, b);
}

// Grant/revoke on every account id the event names. Normally one; TRANSFER
// carries arrays because an entitlement is moving between ids.
async function setAdsRemoved(uids, adsRemoved, eventId) {
  const admin = getAdmin();
  const db = admin.firestore();
  await Promise.all(
    uids.filter(isRealUid).map(uid =>
      db.collection("users").doc(uid).set(
        {
          adsRemoved,
          ...(adsRemoved ? { adsRemovedAt: Date.now() } : {}),
          adsRemovedSource: "play",
          revenueCatEventId: eventId || null,
        },
        { merge: true }
      )
    )
  );
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) {
    console.error("RevenueCat webhook is not configured (REVENUECAT_WEBHOOK_SECRET)");
    return { statusCode: 500, body: "RevenueCat webhook not configured" };
  }
  // Netlify lowercases header names; RevenueCat sends whatever literal string is
  // configured as the Authorization value.
  if (!secretMatches(event.headers["authorization"], expected)) {
    console.error("RevenueCat webhook rejected: bad Authorization header");
    return { statusCode: 401, body: "Unauthorized" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    console.error("RevenueCat webhook sent unparseable JSON", e);
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const rcEvent = body.event;
  if (!rcEvent?.type) {
    return { statusCode: 400, body: "Missing event" };
  }

  // Ignore purchases of anything that doesn't grant ad removal. Older payloads
  // use the singular `entitlement_id`; when neither field is present (some event
  // types omit them) fall through and let the event type decide.
  const entitlements = rcEvent.entitlement_ids
    || (rcEvent.entitlement_id ? [rcEvent.entitlement_id] : null);
  if (entitlements && !entitlements.includes(ENTITLEMENT)) {
    return { statusCode: 200, body: JSON.stringify({ received: true, ignored: "entitlement" }) };
  }

  try {
    if (rcEvent.type === "TRANSFER") {
      // The entitlement moved between app-user ids (typically anonymous → uid
      // once the user signs in). Grant to the destination, revoke the source.
      await setAdsRemoved(rcEvent.transferred_to || [], true, rcEvent.id);
      await setAdsRemoved(rcEvent.transferred_from || [], false, rcEvent.id);
    } else if (GRANT_EVENTS.has(rcEvent.type) || REVOKE_EVENTS.has(rcEvent.type)) {
      const uid = isRealUid(rcEvent.app_user_id) ? rcEvent.app_user_id : rcEvent.original_app_user_id;
      if (!isRealUid(uid)) {
        // Anonymous purchase — the app will re-report it as a TRANSFER after sign-in.
        console.warn("RevenueCat event for an anonymous app_user_id", rcEvent.type, rcEvent.id);
        return { statusCode: 200, body: JSON.stringify({ received: true, ignored: "anonymous" }) };
      }
      await setAdsRemoved([uid], GRANT_EVENTS.has(rcEvent.type), rcEvent.id);
    }
    // Anything else (TEST, CANCELLATION of a still-active period, …) is a no-op.
  } catch (e) {
    console.error("Failed to record RevenueCat entitlement in Firestore", e);
    // 500 so RevenueCat retries rather than dropping a paid purchase.
    return { statusCode: 500, body: "Failed to record entitlement" };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}

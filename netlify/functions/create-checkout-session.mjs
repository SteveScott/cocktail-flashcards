import Stripe from "stripe";
import { getAdmin } from "./_firebaseAdmin.mjs";

// Managed Payments requires this (or a later) API version, passed per-request
// below rather than pinned on the Stripe client.
const MANAGED_PAYMENTS_API_VERSION = "2026-02-25.preview";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // Identify the purchasing user from their Firebase ID token so the webhook
  // knows whose account to mark ad-free. Never trust a uid sent by the client directly.
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return { statusCode: 401, body: JSON.stringify({ error: "Missing Authorization bearer token" }) };
  }

  let uid, email;
  try {
    const admin = getAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
    email = decoded.email;
  } catch (e) {
    console.error("Token verification failed", e);
    // TEMP DEBUG: surface the real Admin-SDK failure reason to the client so it
    // shows in the browser Network tab. Revert to the generic message once fixed.
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid or expired sign-in token", detail: String(e && e.message || e) }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY is not configured");
    return { statusCode: 500, body: JSON.stringify({ error: "Payments aren't configured yet" }) };
  }
  if (!process.env.STRIPE_PRICE_ID) {
    console.error("STRIPE_PRICE_ID is not configured (run scripts/create-remove-ads-product.mjs)");
    return { statusCode: 500, body: JSON.stringify({ error: "Payments aren't configured yet" }) };
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = event.headers.origin || `https://${event.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: uid,
        customer_email: email || undefined,
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        managed_payments: { enabled: true },
        metadata: { uid },
        success_url: `${origin}/?purchase=success`,
        cancel_url: `${origin}/?purchase=cancelled`,
      },
      { apiVersion: MANAGED_PAYMENTS_API_VERSION }
    );
    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    console.error("Failed to create checkout session", e);
    // TEMP DEBUG: surface Stripe's real error to the client Network tab.
    // Revert to the generic message once checkout works.
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to start checkout", detail: String(e && e.message || e) }) };
  }
}

import Stripe from "stripe";
import { getAdmin } from "./_firebaseAdmin.mjs";

// Stripe calls this endpoint directly (not the browser), so it must verify the
// request's signature rather than trust its contents. Configure this URL as
// the webhook endpoint in the Stripe dashboard:
//   https://<your-domain>/.netlify/functions/stripe-webhook
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const signature = event.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!process.env.STRIPE_SECRET_KEY || !webhookSecret) {
    console.error("Stripe webhook is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET)");
    return { statusCode: 500, body: "Stripe webhook not configured" };
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, signature, webhookSecret);
  } catch (e) {
    console.error("Webhook signature verification failed", e);
    return { statusCode: 400, body: `Webhook Error: ${e.message}` };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const uid = session.client_reference_id || session.metadata?.uid;
    if (!uid) {
      console.error("Checkout session completed without a uid reference", session.id);
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }
    try {
      const admin = getAdmin();
      await admin.firestore().collection("users").doc(uid).set(
        { adsRemoved: true, adsRemovedAt: Date.now(), stripeSessionId: session.id },
        { merge: true }
      );
    } catch (e) {
      console.error("Failed to record purchase in Firestore", e);
      return { statusCode: 500, body: "Failed to record purchase" };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}

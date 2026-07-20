import Stripe from "stripe";
import { getAdmin } from "./_firebaseAdmin.mjs";

// One-time "remove ads" purchase price.
const PRICE_CENTS = 1299; // $12.99
const CURRENCY = "usd";

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
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid or expired sign-in token" }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY is not configured");
    return { statusCode: 500, body: JSON.stringify({ error: "Payments aren't configured yet" }) };
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = event.headers.origin || `https://${event.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: uid,
      customer_email: email || undefined,
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            unit_amount: PRICE_CENTS,
            product_data: { name: "Cocktail Flashcards — Remove Ads (one-time)" },
          },
          quantity: 1,
        },
      ],
      metadata: { uid },
      success_url: `${origin}/?purchase=success`,
      cancel_url: `${origin}/?purchase=cancelled`,
    });
    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    console.error("Failed to create checkout session", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to start checkout" }) };
  }
}

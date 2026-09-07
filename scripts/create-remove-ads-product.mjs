// One-time setup script: creates the Stripe Product + one-time Price for the
// "Cocktail Flashcards Pro" purchase and prints the price ID to store in
// STRIPE_PRICE_ID. Pro is one purchase carrying two things: the whole cocktail
// library in study and quizzes (the free tier covers the top 50), and no ads.
//
// RENAMING AN EXISTING PRODUCT: a product already created by this script keeps
// the name Stripe has on file, and that is the name buyers read on the Checkout
// page. Editing the strings below does not reach it — rename it in the Stripe
// dashboard (test mode and live mode both) so the page describes what is
// actually being sold.
//
// Run locally with your Stripe secret key:
//   STRIPE_SECRET_KEY=sk_test_... node scripts/create-remove-ads-product.mjs
//
// This only needs to be run once per Stripe account (test mode and live mode
// each need their own product/price, so run it once per mode).
//
// CHANGING THE PRICE: a Stripe Price is immutable, so editing PRICE_CENTS and
// re-running does not reprice the old one -- it mints a NEW price, and nothing
// changes for buyers until STRIPE_PRICE_ID in Netlify points at it. Keep the
// value in step with the Play Store product and with the button label in
// src/App.jsx; the two storefronts selling the same thing at different prices
// is how refund requests start.
import Stripe from "stripe";

const MANAGED_PAYMENTS_API_VERSION = "2026-02-25.preview";
const PRICE_CENTS = 499; // $4.99
const CURRENCY = "usd";

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const product = await stripe.products.create(
  {
    name: "Cocktail Flashcards Pro (one-time)",
    description: "Unlocks every cocktail for study and quizzes, and removes ads, permanently, for this account.",
    // SaaS delivered electronically (an app feature unlock), for personal use.
    tax_code: "txcd_10103100",
    default_price_data: {
      unit_amount: PRICE_CENTS,
      currency: CURRENCY,
    },
  },
  { apiVersion: MANAGED_PAYMENTS_API_VERSION }
);

console.log("Created product:", product.id);
console.log("Created price:", product.default_price);
console.log("\nSet this in your Netlify environment variables:");
console.log(`STRIPE_PRICE_ID=${product.default_price}`);

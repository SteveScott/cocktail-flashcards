// One-time setup script: creates the Stripe Product + one-time Price for the
// "Remove Ads" purchase and prints the price ID to store in STRIPE_PRICE_ID.
//
// Run locally with your Stripe secret key:
//   STRIPE_SECRET_KEY=sk_test_... node scripts/create-remove-ads-product.mjs
//
// This only needs to be run once per Stripe account (test mode and live mode
// each need their own product/price, so run it once per mode).
import Stripe from "stripe";

const MANAGED_PAYMENTS_API_VERSION = "2026-02-25.preview";
const PRICE_CENTS = 1299; // $12.99
const CURRENCY = "usd";

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const product = await stripe.products.create(
  {
    name: "Cocktail Flashcards — Remove Ads (one-time)",
    description: "Removes ads from the Cocktail Flashcards app, permanently, for this account.",
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

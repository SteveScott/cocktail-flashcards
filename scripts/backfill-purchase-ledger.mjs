// One-time backfill: seeds purchaseLedger/{uid} for accounts that bought Pro
// before that collection existed.
//
// Going forward, setSourceEntitlement (netlify/functions/_entitlements.mjs)
// keeps users/{uid} and purchaseLedger/{uid} in lockstep on every purchase,
// refund, or transfer — one transaction, both writes. But that only covers
// entitlement CHANGES from here on. An account that bought Pro before the
// ledger shipped and has had no entitlement event since (no refund, no
// replatform) has nothing in purchaseLedger yet: their users/{uid} document is
// still the only copy of that purchase, exactly the situation this whole
// feature exists to not leave anyone in. This script closes that gap once.
//
// Skips any uid that already has a purchaseLedger entry, so it is safe to run
// more than once and safe to run after real traffic has started closing the
// gap on its own.
//
// Dry run by default — prints what it would do. Pass --apply to actually write.
//
// Run locally with the same server-side credentials the Netlify functions use:
//   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
//     node scripts/backfill-purchase-ledger.mjs [--apply]
import { FieldPath } from "firebase-admin/firestore";
import { getAdmin } from "../netlify/functions/_firebaseAdmin.mjs";

const APPLY = process.argv.includes("--apply");
const PAGE_SIZE = 300;

// The same fields setSourceEntitlement writes to both collections. Kept here
// rather than imported: this is a one-off migration, and pinning its own copy
// of the list means a later change to what counts as a purchase field cannot
// silently change what a backfill run considers worth copying.
const PURCHASE_FIELDS = [
  "adsRemoved",
  "adsRemovedStripe",
  "adsRemovedPlay",
  "adsRemovedAt",
  "adsRemovedSource",
  "stripeSessionId",
  "revenueCatEventId",
];

function purchaseOf(data) {
  const out = {};
  for (const f of PURCHASE_FIELDS) if (data[f] !== undefined) out[f] = data[f];
  return out;
}

const db = getAdmin().firestore();
let cursor = null;
let scanned = 0, alreadyHadLedger = 0, nothingToCopy = 0, seeded = 0;

for (;;) {
  let query = db.collection("users").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if (cursor) query = query.startAfter(cursor);
  const snap = await query.get();
  if (snap.empty) break;

  const ledgerRefs = snap.docs.map((d) => db.collection("purchaseLedger").doc(d.id));
  const ledgerSnaps = await db.getAll(...ledgerRefs);

  const batch = db.batch();
  let batchWrites = 0;

  snap.docs.forEach((userDoc, i) => {
    scanned += 1;
    if (ledgerSnaps[i].exists) { alreadyHadLedger += 1; return; }

    const purchase = purchaseOf(userDoc.data() || {});
    if (Object.keys(purchase).length === 0) { nothingToCopy += 1; return; }

    seeded += 1;
    console.log(`${APPLY ? "seeding" : "would seed"} purchaseLedger/${userDoc.id}:`, purchase);
    if (APPLY) { batch.set(ledgerRefs[i], purchase); batchWrites += 1; }
  });

  if (APPLY && batchWrites > 0) await batch.commit();

  cursor = snap.docs[snap.docs.length - 1];
  if (snap.docs.length < PAGE_SIZE) break;
}

console.log(`\nScanned ${scanned} accounts.`);
console.log(`  ${alreadyHadLedger} already had a ledger entry (untouched).`);
console.log(`  ${nothingToCopy} had no purchase fields to copy.`);
console.log(`  ${seeded} ${APPLY ? "seeded" : "would be seeded"}.`);
if (!APPLY && seeded > 0) console.log("\nDry run only — re-run with --apply to write.");

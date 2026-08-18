import { getAdmin } from "./_firebaseAdmin.mjs";

// Deletes a user's account and the data held under it. Google Play requires any
// app offering account creation to also offer deletion, and the Data safety
// form asks for the URL where that happens.
//
// This has to run server-side. firestore.rules sets `allow delete: if false` on
// users/{uid} so a buyer cannot erase their own purchase record, and the client
// SDK's deleteUser() additionally fails with auth/requires-recent-login for
// anyone who signed in more than a few minutes ago. The Admin SDK bypasses both:
// it ignores security rules and does not care how old the session is.
//
// Order matters. The Firestore documents go first — if the auth user were
// deleted first and the Firestore delete then failed, they would be orphaned
// under a uid that can never sign in again to retry.
//
// Doc id = the lowercased email, matching how the client writes it
// (src/firebase.js → normalizeEmail).
const AD_WHITELIST_COLLECTION = "adWhitelist";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // Never accept a uid from the client: that would let anyone delete any
  // account. The uid comes only from a verified ID token.
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return { statusCode: 401, body: JSON.stringify({ error: "Missing Authorization bearer token" }) };
  }

  let admin, uid, email;
  try {
    admin = getAdmin();
    // checkRevoked: a token issued before a password change or a prior deletion
    // should not still authorize destroying data.
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    uid = decoded.uid;
    // Only ever the token's own email — never one supplied by the caller, which
    // would let anyone remove another account's ad whitelisting.
    email = (decoded.email || "").trim().toLowerCase();
  } catch (e) {
    console.error("Token verification failed", e);
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid or expired sign-in token" }) };
  }

  // Both deletes in one batch so the "Nothing was removed" message below stays
  // true: a failure leaves the account exactly as it was, ready for a retry.
  // Deleting a document that isn't there is a no-op, so the whitelist entry
  // needs no existence check — most users never have one.
  try {
    const db = admin.firestore();
    const batch = db.batch();
    batch.delete(db.collection("users").doc(uid));
    if (email) batch.delete(db.collection(AD_WHITELIST_COLLECTION).doc(email));
    await batch.commit();
  } catch (e) {
    console.error("Failed to delete user data", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not delete your data. Nothing was removed." }) };
  }

  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    // The documents are already gone, so report partial success rather than
    // implying nothing happened — a retry is safe, since deleting an absent
    // document is a no-op.
    console.error("Deleted user document but failed to delete auth user", uid, e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Your data was deleted, but the sign-in account could not be removed. Please contact support." }),
    };
  }

  console.log("Deleted account and data for", uid);
  return { statusCode: 200, body: JSON.stringify({ deleted: true }) };
}

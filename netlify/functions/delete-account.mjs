import { getAdmin } from "./_firebaseAdmin.mjs";
import { eraseUser, whitelistEmails, normalizeEmail } from "./_eraseUser.mjs";

// Deletes a user's account and the data held under it. Google Play requires any
// app offering account creation to also offer deletion, and the Data safety
// form asks for the URL where that happens.
//
// This has to run server-side. firestore.rules sets `allow delete: if false` on
// users/{uid} so a buyer cannot erase their own purchase record, the same on
// highWater/{uid} — a high-water mark its owner can delete is not one — and
// purchaseLedger/{uid} is denied to every client outright. The client SDK's
// deleteUser() additionally fails with auth/requires-recent-login for anyone
// who signed in more than a few minutes ago. The Admin SDK bypasses all of it:
// it ignores security rules and does not care how old the session is.
//
// What actually gets deleted, in what order, lives in _eraseUser.mjs — shared
// with admin-erase-user.mjs, which does the same wipe on request for somebody
// who wrote in rather than pressing the button. The two doors must remove the
// same things, and the only way to be sure of that is for there to be one
// implementation of "remove them".

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
    email = normalizeEmail(decoded.email);
  } catch (e) {
    console.error("Token verification failed", e);
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid or expired sign-in token" }) };
  }

  // The token carries one address; the account may be whitelisted under another
  // that a sign-in provider reports. Reading the auth record picks those up too,
  // and a failure to read it is not a reason to refuse the deletion — it just
  // falls back to the address we already hold, which is what this endpoint used
  // before the lookup existed.
  let emails = [email];
  try {
    emails = [...new Set([...whitelistEmails(await admin.auth().getUser(uid)), email].filter(Boolean))];
  } catch (e) {
    console.error("Could not read the auth record for whitelist addresses; using the token's", e);
  }

  try {
    await eraseUser({ uid, emails });
  } catch (e) {
    if (e.phase === "auth") {
      // The documents are already gone, so report partial success rather than
      // implying nothing happened — a retry is safe, since deleting an absent
      // document is a no-op.
      console.error("Deleted user document but failed to delete auth user", uid, e.cause || e);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Your data was deleted, but the sign-in account could not be removed. Please contact support." }),
      };
    }
    // A failure in the batch leaves the account exactly as it was, ready for a
    // retry, which is what makes "Nothing was removed" true.
    console.error("Failed to delete user data", e.cause || e);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not delete your data. Nothing was removed." }) };
  }

  console.log("Deleted account and data for", uid);
  return { statusCode: 200, body: JSON.stringify({ deleted: true }) };
}

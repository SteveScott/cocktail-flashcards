import { getAdmin } from "./_firebaseAdmin.mjs";

// Who may call the restore endpoint. The same list the client reads to decide
// whether to draw the admin panel — one variable, one set of people, nothing to
// keep in step. Netlify hands every site variable to a function regardless of
// its name; the VITE_ prefix is a Vite build convention about what gets inlined
// into the browser bundle, not a limit on what the server can see.
//
// It being in that bundle is not a weakness here, because the list is not a
// secret and was never doing the work. The boundary is the signature check
// below: an address only matters to someone already holding a Firebase ID token
// minted for it, and those cannot be forged. Reading the list tells an attacker
// whose account to go after, which firestore.rules already tells them — its
// admins() carries the same addresses in plaintext.
function adminEmails() {
  return (process.env.VITE_ADMIN_EMAILS || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
}

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Verifies the caller is a signed-in administrator, applying the same three
// conditions firestore.rules -> isAdmin() does: a real session, an email the
// provider has verified, and that email on the list. Mirrored on purpose — the
// rules do not run for the Admin SDK, so this is the only check there is.
export async function requireAdmin(event) {
  const allowed = adminEmails();
  // An empty list is a misconfiguration, not an open door. Failing closed here
  // is what keeps a deploy that forgot VITE_ADMIN_EMAILS from exposing the
  // restore endpoint to every signed-in user in the project.
  if (allowed.length === 0) {
    throw new HttpError(503, "No administrators are configured for this deployment.");
  }

  const header = event.headers.authorization || event.headers.Authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!idToken) throw new HttpError(401, "Missing Authorization bearer token");

  let decoded;
  try {
    // checkRevoked: a token minted before the account was disabled or its
    // password changed must not still authorize reading or rewriting the
    // whole database.
    decoded = await getAdmin().auth().verifyIdToken(idToken, true);
  } catch (e) {
    console.error("Admin token verification failed", e);
    throw new HttpError(401, "Invalid or expired sign-in token");
  }

  const email = (decoded.email || "").trim().toLowerCase();
  if (decoded.email_verified !== true || !email || !allowed.includes(email)) {
    // Deliberately not "you are not an administrator": whether a given address
    // is on the list is not something an arbitrary caller should be able to
    // probe one request at a time.
    console.warn("Rejected non-admin call to an admin endpoint", decoded.uid);
    throw new HttpError(403, "Not authorized");
  }
  return { uid: decoded.uid, email };
}

// One shape for every failure these endpoints return, so a 500 never leaks the
// internals of a stack trace to the browser while still reaching the log.
export function errorResponse(e) {
  const statusCode = e instanceof HttpError ? e.statusCode : 500;
  if (statusCode === 500) console.error("Admin function failed", e);
  return {
    statusCode,
    body: JSON.stringify({ error: statusCode === 500 ? "Something went wrong. Nothing was changed." : e.message }),
  };
}

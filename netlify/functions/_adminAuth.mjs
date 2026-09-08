import { getAdmin } from "./_firebaseAdmin.mjs";

// Who may call the backup and restore endpoints.
//
// Deliberately NOT the VITE_ADMIN_EMAILS the client reads. That one is compiled
// into the JS bundle every visitor downloads, and all it decides is whether the
// admin panel is drawn — anyone can set it in their own copy. This one lives
// only on the server, and it is the single thing standing between a stolen
// session and every user document in the project, because the Admin SDK these
// functions use bypasses firestore.rules entirely.
function adminEmails() {
  return (process.env.ADMIN_EMAILS || "")
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
  // is what keeps a deploy that forgot ADMIN_EMAILS from exposing the restore
  // endpoint to every signed-in user in the project.
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

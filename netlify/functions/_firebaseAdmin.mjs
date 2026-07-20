import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let app;

// Lazily initializes the Firebase Admin SDK from server-only env vars (never
// exposed to the client / not prefixed with VITE_). Required so this function
// can verify a user's Firebase ID token and write to Firestore with
// privileges the client's security rules intentionally don't grant it.
//
// Uses the modular firebase-admin API (firebase-admin/app etc.) rather than the
// legacy default-namespace import: under ESM/esbuild bundling on Netlify, the
// default export's `admin.credential` is undefined, which made `credential.cert`
// throw before any token was ever verified.
export function getAdmin() {
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Firebase Admin credentials are not configured (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)."
      );
    }
    app = getApps()[0] || initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  // Preserve the previous call shape (admin.auth() / admin.firestore()) so the
  // calling functions don't need to change.
  return {
    auth: () => getAuth(app),
    firestore: () => getFirestore(app),
  };
}

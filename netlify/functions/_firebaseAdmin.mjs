import admin from "firebase-admin";

let initialized = false;

// Lazily initializes the Firebase Admin SDK from server-only env vars (never
// exposed to the client / not prefixed with VITE_). Required so this function
// can verify a user's Firebase ID token and write to Firestore with
// privileges the client's security rules intentionally don't grant it.
export function getAdmin() {
  if (!initialized) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Firebase Admin credentials are not configured (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)."
      );
    }
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
    initialized = true;
  }
  return admin;
}

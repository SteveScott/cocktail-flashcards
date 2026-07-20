import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, FacebookAuthProvider } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export const app = firebaseEnabled ? initializeApp(firebaseConfig) : null;
export const auth = firebaseEnabled ? getAuth(app) : null;
export const db = firebaseEnabled ? getFirestore(app) : null;
export const googleProvider = new GoogleAuthProvider();
export const facebookProvider = new FacebookAuthProvider();

// ── Ad whitelist ────────────────────────────────────────────────────────
// Users whose Google account email is present in this Firestore collection
// (doc id = lowercased email) never see ads. Actual access control for who
// may WRITE to this collection must be enforced by Firestore security rules
// (see README), not by this client-side code.
const AD_WHITELIST_COLLECTION = "adWhitelist";

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

export async function isEmailAdWhitelisted(email) {
  if (!db) return false;
  const id = normalizeEmail(email);
  if (!id) return false;
  const snap = await getDoc(doc(db, AD_WHITELIST_COLLECTION, id));
  return snap.exists();
}

export async function addEmailToAdWhitelist(email, addedBy) {
  if (!db) throw new Error("Cloud sync isn't configured for this app yet.");
  const id = normalizeEmail(email);
  if (!id) throw new Error("Email is required");
  await setDoc(doc(db, AD_WHITELIST_COLLECTION, id), { addedAt: Date.now(), addedBy: addedBy || null });
}

export async function removeEmailFromAdWhitelist(email) {
  if (!db) return;
  const id = normalizeEmail(email);
  if (!id) return;
  await deleteDoc(doc(db, AD_WHITELIST_COLLECTION, id));
}

export async function listAdWhitelist() {
  if (!db) return [];
  const snap = await getDocs(collection(db, AD_WHITELIST_COLLECTION));
  return snap.docs.map(d => ({ email: d.id, ...d.data() }));
}

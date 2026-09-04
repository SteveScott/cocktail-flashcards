// Native Google sign-in for the Capacitor (Play Store) build.
//
// The Firebase JS SDK's browser flows can't complete inside an Android WebView.
// `signInWithPopup` opens a child window with no working postMessage channel
// back to the opener, so it waits forever; `signInWithRedirect` navigates to
// accounts.google.com, which refuses OAuth from embedded user agents. Either
// way the app is left parked on a blank page — the white screen.
//
// So on native we hand sign-in to Android's own account picker via
// @capacitor-firebase/authentication, then exchange the Google ID token it
// returns for a Firebase session with signInWithCredential. The plugin runs
// with skipNativeAuth (see capacitor.config.json) so it does the account
// picking and nothing else: the session still lives in the JS SDK, and every
// consumer downstream — onAuthStateChanged, the Firestore subscription, the ad
// whitelist lookup — keeps working unchanged on both web and native.

import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { auth, firebaseEnabled } from "./firebase";
import { isCapacitorApp } from "./platform";

const PLUGIN_NAME = "FirebaseAuthentication";

// Loaded on demand rather than at module scope: the same bundle is served to
// the web, where this path is never taken and the plugin is dead weight.
function loadPlugin() {
  return import("@capacitor-firebase/authentication");
}

// Is the NATIVE half of the plugin present in the binary we're running in?
//
// This has to be asked at runtime, not assumed. The store app loads the live
// site (capacitor.config.json → server.url), so web deploys and Play releases
// ship on independent schedules and this JS will reach installs that predate
// the plugin — anything at or below versionCode 4. `isPluginAvailable` answers
// true for a JS-only implementation too, which is why isCapacitorApp is
// checked first: on the web we want the popup flow, not the plugin's own web
// fallback (which is just signInWithPopup again).
export function nativeGoogleSignInAvailable() {
  if (!firebaseEnabled || !isCapacitorApp) return false;
  try {
    return Boolean(window.Capacitor?.isPluginAvailable?.(PLUGIN_NAME));
  } catch {
    return false;
  }
}

// Runs the native account picker and signs the JS SDK in with the result.
// Throws on failure so the caller can decide between showing an error and
// falling back to the web flow.
export async function signInWithGoogleNative() {
  const { FirebaseAuthentication } = await loadPlugin();
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result?.credential?.idToken;
  if (!idToken) {
    // Can happen if the picker is dismissed in a way the plugin reports as
    // success. Surfacing it beats leaving the user signed out with no reason.
    throw new Error("Google sign-in returned no ID token.");
  }
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
}

// Clear the native side's cached credential alongside the JS SDK's session.
//
// skipNativeAuth keeps the Firebase session in JS, but the plugin still holds
// the Google account selection underneath. Without this, "Sign out" followed by
// "Sign in with Google" silently re-selects the same account with no picker,
// which reads as a broken sign-out. Best-effort: a failure here must not stop
// the JS sign-out that actually ends the session.
export async function signOutGoogleNative() {
  if (!nativeGoogleSignInAvailable()) return;
  try {
    const { FirebaseAuthentication } = await loadPlugin();
    await FirebaseAuthentication.signOut();
  } catch (e) {
    console.error("Native sign-out failed", e);
  }
}

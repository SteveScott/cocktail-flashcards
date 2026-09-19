// Which BINARY is this, as opposed to which version of the site it has loaded.
//
// The Play shell loads the deployed site (capacitor.config.json → server.url),
// so `__APP_VERSION__` — the number in the footer, the one in the sign-in
// diagnostics — is the site's, on the web and in the app alike. The APK around
// it can be any age at all, and until AppReleasePlugin.java there was nothing
// on the device that could say which. Two weeks of "update from Play" with no
// way to tell whether the update had landed is what that cost; see
// docs/mobile-google-signin.md.
//
// Like src/launcher-icon.js this is a no-op away from the Play build, and a
// caught rejection on a native shell that predates the plugin — which is every
// shell built before the first upload carrying it, and precisely the shells
// worth identifying. Those answer null, and the footer says so.
import { registerPlugin } from "@capacitor/core";
import { isCapacitorApp } from "./platform";

const AppRelease = registerPlugin("AppRelease");

/**
 * `{ versionCode, versionName }` for the running APK, or null where there is no
 * APK to ask about — the web, and any binary without the plugin in it.
 *
 * Gated on isCapacitorApp rather than isPlayApp because this calls a plugin,
 * and the URL flag alone can set isPlayApp with no bridge behind it to take the
 * call. The DISPLAY of the answer is gated the other way round, in App.jsx: a
 * shell whose bridge never arrived is still not the web, and "unknown" is the
 * honest thing to show there.
 */
export async function getAndroidRelease() {
  if (!isCapacitorApp) return null;
  try {
    const info = await AppRelease.get();
    // A bridge that doesn't know the plugin can resolve with nothing rather
    // than reject, so an answer missing the number is no answer.
    if (!info || info.versionCode == null) return null;
    return { versionCode: info.versionCode, versionName: info.versionName || null };
  } catch (e) {
    // Every shell older than this feature, which is not a fault.
    console.debug("No native release number:", e?.message || e);
    return null;
  }
}

// The Android home screen icon, kept in step with the colour scheme.
//
// The scheme is a per-device preference (THEMES in App.jsx) and it dresses every
// pixel of the app — except the one the user sees most often with the app shut.
// A Future user leaving a walnut-and-brass glass on their home screen is the one
// place the scheme visibly does not hold, and it is the place a colour scheme is
// most worth holding: the icon is what the app looks like from outside.
//
// Android does not let an app change its icon. What it allows is several
// launcher entries with different icons and exactly one of them enabled, so
// android/app/src/main/AndroidManifest.xml declares an <activity-alias> per
// scheme and LauncherIconPlugin.java flips them. This is the JavaScript end of
// that: it asks, and the native side does the swap as the app is backgrounded.
//
// Everything here is a no-op away from the Play build, and a caught rejection on
// a native shell that predates the plugin — the shell loads the DEPLOYED site
// (capacitor.config.json → server.url), so this code runs inside APKs that have
// never heard of a LauncherIcon plugin. Changing the scheme must not be able to
// fail because of it.
import { registerPlugin } from "@capacitor/core";
import { isCapacitorApp } from "./platform";

// Native only, by design: there is no web fallback to register, because there is
// nothing on the web this could mean.
const LauncherIcon = registerPlugin("LauncherIcon");

// The last scheme asked for. The caller is a React effect, so it can run again
// with an unchanged value; this keeps a re-render off the bridge.
let requested = null;

export function setLauncherIcon(scheme) {
  if (!isCapacitorApp || !scheme || scheme === requested) return;
  requested = scheme;
  try {
    // Resolves as soon as the request is recorded — the icon changes when the
    // app next goes to the background, which is the earliest anyone could see
    // it. Nothing here waits for that, and nothing depends on the answer.
    LauncherIcon.set({ scheme }).catch((e) => {
      // Reached on every older shell, so this is expected rather than broken.
      console.debug("Launcher icon unchanged:", e?.message || e);
    });
  } catch (e) {
    console.debug("Launcher icon unchanged:", e?.message || e);
  }
}

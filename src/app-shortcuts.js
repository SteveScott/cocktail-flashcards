// The launcher's long-press menu, on the JavaScript side.
//
// Long-pressing the home screen icon on Android offers Study, Self Quiz and
// 86 It. Each one starts the app with cocktailflashcards://shortcut/<id> on the
// intent; AppShortcutPlugin.java reads it and this is what asks. The ids are the
// contract between the two, and they are also written into
// android/app/src/main/res/xml/shortcuts.xml and ShortcutRoutes.java — three
// places, none of which either build can check against the others, which is what
// tests/app-shortcuts.test.mjs is for.
//
// Like src/launcher-icon.js this is a no-op away from the Play build, and a
// caught rejection on a native shell that predates the plugin. The shell loads
// the DEPLOYED site (capacitor.config.json -> server.url), so this exact code
// runs inside APKs that have never heard of an AppShortcut plugin, and inside
// ordinary browsers. Neither may see an error because of it.
//
// That split is also the deploy order. The native half of this feature ships in
// the AAB and this half ships on the site, so the site has to go first: a shell
// installed ahead of the deploy has shortcuts in its launcher and no code to
// route them, and every one of them opens the app on the menu.
import { registerPlugin } from "@capacitor/core";
import { isCapacitorApp } from "./platform";

const AppShortcut = registerPlugin("AppShortcut");

// The ids the native side can send. Anything else is dropped rather than
// forwarded: a shortcut pinned by an older build can outlive the id it was
// pinned with, and the handler's job is to move the app to a mode, which is not
// a thing to attempt on a name nothing recognises.
export const SHORTCUTS = ["study", "self-quiz", "86-it"];

/**
 * Call `handler(id)` for the shortcut that opened the app, and for any tapped
 * while it is open. Returns a cleanup function.
 *
 * Both halves are needed and they are genuinely different events:
 *
 *   - The app was launched by a shortcut. The intent was read before this file
 *     existed, so there is nothing to listen for — the id is sitting on the
 *     native side waiting to be collected, and `consume()` collects it. It
 *     answers once, so a later remount does not re-route a user who has since
 *     navigated somewhere else.
 *
 *   - The app was already open. Android delivers the tap to the running
 *     activity (launchMode="singleTop"), which arrives here as an event.
 */
export function onShortcut(handler) {
  if (!isCapacitorApp || typeof handler !== "function") return () => {};

  let live = true;
  const deliver = (id) => {
    if (!live || !SHORTCUTS.includes(id)) return;
    handler(id);
  };

  // Collect the launch shortcut only once the listener is in place, and that
  // order is the whole reason this is a chain rather than two calls.
  //
  // A shortcut tapped in the window between the two is recorded natively and
  // announced; consume-first means the announcement lands on nobody AND the
  // collection has already answered with the older value, so the tap is simply
  // lost. Listen-first can instead deliver the same id twice — once as the
  // event, once as what consume() then returns — and that costs nothing, since
  // the handler only sets a mode and setting it twice is setting it once.
  let handle = null;
  const collectLaunch = () => {
    AppShortcut.consume()
      .then((r) => deliver(r?.shortcut))
      // Every shell older than this feature, which is not a fault.
      .catch((e) => console.debug("No launch shortcut:", e?.message || e));
  };

  try {
    // addListener resolves to a handle in Capacitor 6+, and returns one
    // directly in older bridges. Take either.
    const added = AppShortcut.addListener("shortcut", (e) => deliver(e?.shortcut));
    if (added && typeof added.then === "function") {
      added.then((h) => {
        // Unsubscribed before the handle arrived — remove it, don't keep it.
        if (live) handle = h; else h?.remove?.();
        collectLaunch();
      }).catch((e) => {
        console.debug("No shortcut listener:", e?.message || e);
        // An old shell has neither half, but ask anyway rather than assume: the
        // two calls fail independently, and a launch shortcut is worth more
        // than a listener.
        collectLaunch();
      });
    } else {
      handle = added;
      collectLaunch();
    }
  } catch (e) {
    console.debug("Shortcuts unavailable:", e?.message || e);
  }

  return () => {
    live = false;
    try { handle?.remove?.(); } catch { /* bridge already gone */ }
  };
}

# Testing the Android build

The Play build is the one part of this project that cannot be checked from a
browser. It is a WebView on the deployed site plus a short list of native
features — the launcher icon that follows the colour scheme, the home screen
shortcuts, native Google sign-in, AdMob and Play Billing — and every one of them
fails in a way that is invisible from the web app and usually invisible from the
emulator too.

This is what to run, what to check by hand, and where to write down that you did.

## The automated checks

Three suites, at three different distances from a device. Run them in this
order; each is cheaper than the next and catches a different kind of mistake.

```bash
npm run lint                      # eslint over src/
npm test                          # node tests/, including the shortcut wiring
cd android
./gradlew :app:testDebugUnitTest  # JVM unit tests, no device
./gradlew :app:assembleDebug      # it compiles
```

`npm test` includes `tests/app-shortcuts.test.mjs`, which is the one worth
knowing about: the launcher shortcuts are spelled out across `shortcuts.xml`,
`ShortcutRoutes.java`, `src/app-shortcuts.js`, `strings.xml` and the manifest,
and nothing in either build reads more than one of those. That test reads all
five and compares them, so a shortcut that would have opened the app on the menu
instead of the quiz fails on a laptop rather than on someone's phone.

`ShortcutRoutesTest` is a plain JVM test and needs no device, which is the whole
reason `ShortcutRoutes` is free of `android.net.Uri` — on the JVM that class is
a stub whose methods throw rather than parse.

With a device or emulator attached:

```bash
cd android
./gradlew :app:connectedDebugAndroidTest
```

`LauncherShortcutsTest` covers the half that only exists once the app is
installed: whether the system actually published the three shortcuts, and
whether what they point at can be launched. A shortcut with a bad component does
not warn at build time — it simply does nothing when tapped.

## The manual pass

What is left needs a real phone, because it is either about the launcher, about
the network, or about money.

**Before any of it: the site must already carry the build you are testing
against.** The shell loads the deployed site, so half of most features on this
list lives there rather than in the APK — the shortcut routing certainly does.
Testing a fresh install against a site that has not caught up produces failures
that are not bugs: the shortcuts appear, they launch the app, and they all land
on the menu. Deploy first, then install, then work through this.

### Launcher icon and shortcuts

The icon and the shortcut menu are the only surfaces visible with the app shut,
and the alias-flipping behind them is the part most likely to break quietly.

- [ ] Long-press the icon. Study, Self Quiz and 86 It are listed, with icons and
      with labels that are not truncated.
- [ ] Tap each one from a **cold start** (swipe the app out of Recents first).
      Each lands on the matching screen, and quizzes land on the length picker —
      not on a running quiz.
- [ ] Tap each one while the app is **already open**, on some other screen. Same
      destination. This is the `onNewIntent` path and it is a different code
      path from the cold start.
- [ ] Open a shortcut, navigate away to the menu, then background and resume the
      app. It stays on the menu — a shortcut is collected once, and a resume
      must not re-route you.
- [ ] Switch the colour scheme to Future, leave the app so the icon swaps, then
      long-press the new icon. The menu is still there. This is the check that
      the shortcut list is declared on *both* launcher aliases, and the one most
      likely to have been missed.
- [ ] With the scheme still on Future, tap a shortcut. It launches. This is the
      check that shortcuts target `CocktailActivity` rather than the alias that
      has just been disabled.
- [ ] Drag a shortcut onto the home screen to pin it, then switch scheme and tap
      the pinned copy. It still launches.

### The rest of the native surface

- [ ] Sign in with Google, sign out, sign in again. See
      [docs/mobile-google-signin.md](mobile-google-signin.md).
- [ ] Turn off the network and open the app. See [docs/pwa.md](pwa.md) for what
      it should say.
- [ ] Study progress survives a sign-out and sign-in on a second device.
- [ ] Ads appear, and stop appearing after a Pro purchase. See
      [docs/mobile-monetization.md](mobile-monetization.md).

### On more than one device

The launcher differs between manufacturers more than anything else here, and the
shortcut menu is drawn entirely by the launcher. Worth a pass on a Pixel-style
launcher and on a Samsung one if you have both, and on the oldest Android you
support — static shortcuts do not exist below API 25, and the app's `minSdk` is
24, so on an API 24 device the long-press menu is simply absent. That is correct
behaviour, not a bug.

## The log

Fill this in as you go, during closed testing as well as before an upload. One
row per session; name the build so a row can be tied to an upload, and say what
you actually exercised rather than "tested".

Leave a row out rather than guessing at it. A log that records less than
happened is worth something; one that records more is worth nothing.

| Date | versionCode / versionName | Device, Android version | Exercised | Result |
|---|---|---|---|---|
| | | | | |

Example of the detail worth having, once there is something to record:

> `2026-09-19` · `9 / 1.3.5` · Pixel 7a, Android 15 · cold-start and
> already-open taps on all three shortcuts; scheme switched to Future and the
> menu re-checked; one shortcut pinned and launched after the swap · all as
> expected, except the 86 It label reads tight on the Samsung launcher.

Google's requirements for a closed test — how many testers, and for how long —
are shown against your own app in the Play Console, and they have changed more
than once. Read them there rather than from any note, including this one.

# Mobile app: Google sign-in (Capacitor)

"Sign in with Google" in the Play build used to open a white screen. This is why,
and what replaced it.

## Why it broke

The app used the Firebase **JS SDK's browser flows** for every platform:
`signInWithPopup`, falling back to `signInWithRedirect`. Neither can finish
inside an Android WebView.

- `signInWithPopup` calls `window.open`. The WebView gives back a child window
  with no working `postMessage` channel to the opener, so the SDK waits for a
  result that never arrives.
- `signInWithRedirect` navigates to `accounts.google.com`, which **refuses OAuth
  from embedded user agents** (`disallowed_useragent`), and the hand-off back
  from the `__/auth/handler` page on a different domain needs third-party
  storage the WebView won't grant.

`allowNavigation` in `capacitor.config.json` lists `*.google.com` and
`*.firebaseapp.com`, so the WebView stayed *inside the app* on that dead page
rather than bouncing out to Chrome — hence a white screen rather than an error.

None of this had anything to do with the Play track. Internal/closed testing
governs who can install the app; it does not restrict OAuth.

## What replaced it

`@capacitor-firebase/authentication` runs **Android's own account picker**
(Credential Manager), which is not a WebView and so isn't subject to any of the
above. It hands back a Google ID token, and `src/native-auth.js` exchanges that
for a Firebase session via `signInWithCredential`.

The plugin runs with **`skipNativeAuth: true`**, so it only picks the account —
the session still lives in the JS SDK. That matters: `onAuthStateChanged`, the
Firestore progress subscription, and the ad-whitelist lookup in `src/App.jsx`
are all JS-SDK consumers and needed no changes.

| | |
|---|---|
| `src/native-auth.js` | Native picker + credential exchange, plus native sign-out |
| `src/App.jsx` | `signIn()` branches; `signOutUser()` also clears the native account |
| `capacitor.config.json` | `FirebaseAuthentication` → `skipNativeAuth`, `providers: ["google.com"]` |
| `android/variables.gradle` | `rgcfaIncludeGoogle = true` |

### The web path is unchanged

The popup/redirect flow is still what runs on the web, where it works fine. Only
the native branch is new.

### Old installs keep working

The store app loads the **live site**, so web deploys and Play releases ship on
independent schedules — this JS reaches installs that predate the plugin
(versionCode 4 and earlier). `nativeGoogleSignInAvailable()` asks the Capacitor
bridge whether the native half is actually present and falls back to the old web
flow when it isn't. So the Netlify deploy is safe to ship before, during and
after the Play rollout; it just doesn't fix anything until the new binary lands.

### Sign-out clears both sides

`skipNativeAuth` leaves the Google account selection cached natively even after
the JS session ends. Without `signOutGoogleNative()`, "Sign out" then "Sign in
with Google" silently re-selects the same account with no picker, which reads as
a broken sign-out.

---

## Firebase Android app: `google-services.json`

`android/app/google-services.json` is in place (project `cocktail-flashcards`,
package `com.bpp.cocktailflashcards`). It is not a secret — it is committed.

It supplies `R.string.default_web_client_id`, the OAuth web client the account
picker authenticates against. Confirm it resolved after any change:

```
grep -o 'default_web_client_id[^<]*<[^<]*' \
  android/app/build/intermediates/incremental/release/mergeReleaseResources/merged.dir/values/values.xml
```

That must show `130519173102-…apps.googleusercontent.com`. If it shows
`WILL_BE_OVERRIDDEN`, the file is missing or wasn't picked up — the plugin ships
that placeholder, so **the app still compiles and ships and then fails at
runtime**. There is no build error to catch this.

### ⚠️ Still outstanding: register the SHA-1 fingerprints

The current `google-services.json` contains only a `client_type: 3` (web) entry
and **no `client_type: 1`**. A `client_type: 1` entry is what Firebase writes for
each registered Android signing certificate, so its absence means no SHA-1 has
been added yet. Play services checks the calling app's package name and signing
certificate against those entries before it will hand back a token, so sign-in
fails until this is done.

In **Firebase Console → Project settings → Your apps → the Android app → Add
fingerprint**, add both:

| | SHA-1 |
|---|---|
| Upload key (`ignore/key`) — for `adb install` builds | `98:37:A1:7E:18:1E:71:A3:3F:2F:F0:3A:31:AE:34:D5:01:C0:6E:6D` |
| Debug key (`~/.android/debug.keystore`) — for `assembleDebug` | `FC:05:17:89:BB:22:7B:8E:21:CB:95:E2:C5:42:2A:B6:B3:70:F2:8E` |

Then add a third, which cannot be read from this machine: the **Play App Signing**
certificate, from *Play Console → Release → Setup → App integrity → App signing
key certificate*. Play re-signs every upload with its own key, so the build your
testers install is **not** signed with the upload key above. Skip this one and
sign-in works over `adb install` and fails from the store — the most expensive
version of this bug to diagnose.

After adding all three, **re-download `google-services.json`** and replace
`android/app/google-services.json`. Adding fingerprints does not update a file
you already downloaded. Verify the new one has `client_type: 1` entries:

```
node -e "JSON.parse(require('fs').readFileSync('android/app/google-services.json','utf8')).client[0].oauth_client.forEach(o=>console.log(o.client_type, o.android_info?.certificate_hash||'(web)'))"
```

Finally, check **Firebase Console → Authentication → Sign-in method → Google** is
enabled.

## Releasing

This adds native code, so a **new Play upload is required** — a Netlify deploy
alone can't deliver it. `versionCode` was bumped to 5.

## Verifying on device

Remote-debug the WebView: connect the device, open `chrome://inspect` in desktop
Chrome, and watch the console while tapping the button.

- Account picker never appears → plugin missing from the binary
  (`Capacitor.isPluginAvailable('FirebaseAuthentication')` is false), or you're
  on an old install.
- `NoClassDefFoundError` → `rgcfaIncludeGoogle` didn't take; the Google libraries
  are `compileOnly` without it.
- Picker appears, then sign-in fails → almost always the SHA-1/`google-services.json`
  step above. Check `adb logcat` for the underlying `GetCredentialException`.
- Still a white screen → you're on the old web flow; the native branch wasn't taken.

## Unrelated, but adjacent

If the **Google Cloud OAuth consent screen** is still in *Testing* publishing
status, only listed test users can sign in; everyone else gets
`Error 403: access_denied`. That's a visible error page, not a white screen, so
it wasn't this bug — but it will bite at production launch.

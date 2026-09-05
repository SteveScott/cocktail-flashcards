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
Every value in it already ships inside the APK, where anyone can read it; access
is enforced by Firestore security rules, not by hiding the file.

**Committing it stops Netlify building until the path is excluded.** The
scanner's smart detection reads the Firebase client key in it as a leaked
secret and fails the build with exit code 2, so `netlify.toml` carries
`SECRETS_SCAN_OMIT_PATHS = "android/app/google-services.json"`. The path is
excluded rather than the value, since pasting the key into
`SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES` would duplicate it into a second
file and disabling smart detection would drop scanning across the whole repo.
Nothing under `android/` is ever served.

That failure is worth recognising quickly, because of how it presents. The web
half of sign-in lives on the deployed site (see *Old installs keep working*),
so a blocked deploy leaves master correct and the live site stale — and the app
keeps taking the old popup path and showing the same white screen it did before
any of this was fixed. It looks exactly like the code change not working. Check
what the site is actually serving before doubting the app:

```
curl -s https://cocktailflashcards.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

then fetch that file and confirm it contains `FirebaseAuthentication`. If it
doesn't, the deploy never landed and nothing about the app is wrong.

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

### The SHA-1 fingerprints — where this actually went wrong

Play services checks the running app's package name **and signing certificate**
against the OAuth clients registered for the project before it will hand back a
token. Every certificate the app might be signed with therefore needs
registering, and a store build is not signed with the key you uploaded.

Getting this wrong cost most of a day. The failure is silent in the worst way:
the app builds, uploads, installs, and shows a picker, then fails.

Add these in **Firebase Console → Project settings → Your apps → the Android
app → Add fingerprint**, one at a time:

| SHA-1 | Covers | Where it comes from |
|---|---|---|
| `98:37:A1:7E:18:1E:71:A3:3F:2F:F0:3A:31:AE:34:D5:01:C0:6E:6D` | local release builds | `ignore/key`, the upload keystore |
| `FC:05:17:89:BB:22:7B:8E:21:CB:95:E2:C5:42:2A:B6:B3:70:F2:8E` | `assembleDebug` | `~/.android/debug.keystore` |
| `5B:EF:83:7F:69:7F:73:09:A7:C4:BC:E1:B8:26:96:F4:41:6A:62:6E` | **Play installs** | Play App Signing, current key |
| `0E:B8:61:D6:5C:1A:72:B4:84:81:E9:05:13:23:58:4B:DD:43:1D:9C` | **Play installs** | Play App Signing, previous key |

The first two can be read back from the keystores with `keytool -list -v`. The
last two only exist in Play Console.

#### Two Play signing keys, not one

The app signing key has been rotated — Play Console lists a **Previous app
signing key** alongside the current one. Rotation uses APK signature scheme v3,
so an app carries a lineage of both certificates and an install may present
either. Register both. The current key showed a **0.0% install base** at the
time of writing, meaning the installs actually out there were still presenting
the *previous* certificate.

#### The trap: there are four fingerprints on that page

Play Console → *Protected with Play* → **App signing** (it moved here from
Release → Setup → App integrity) shows the app signing key as two columns:

```
Classical key                    Post-quantum cryptography key
  SHA-256 certificate fingerprint   SHA-256 certificate fingerprint
  SHA-1 certificate fingerprint     SHA-1 certificate fingerprint
```

**Take the SHA-1 under Classical key.** The post-quantum key is not what the app
is signed with, and copying its SHA-1 instead is what broke this: the
fingerprint registered was `5D:7A:39:CE:…`, which matches nothing the app is
ever signed with — 0 of 20 octets against either real key. It looked plausible
sitting in the list next to two correct entries, and nothing anywhere reports
that a registered fingerprint corresponds to no real certificate.

Further down the same page is the **Upload key certificate**. That one is the
`98:37:A1:7E:…` above, so it doubles as a check that you are looking at the
right app.

#### After adding them

Registration takes effect **server-side**. No rebuild, no new upload, no
redeploy — an already-installed app starts working within a few minutes.

Still re-download `google-services.json` and replace
`android/app/google-services.json`, so the repo matches reality for future
builds. Adding fingerprints does not update a file you already downloaded.
Check what a downloaded file actually contains:

```
node -e "JSON.parse(require('fs').readFileSync('android/app/google-services.json','utf8')).client[0].oauth_client.forEach(o=>console.log(o.client_type, o.android_info?.certificate_hash||'(web)'))"
```

Finally, check **Firebase Console → Authentication → Sign-in method → Google**
is enabled. To test that without a device, POST a deliberately invalid token —
`OPERATION_NOT_ALLOWED` means the provider is off, `INVALID_IDP_RESPONSE` means
it is on and merely rejected the junk token:

```
curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=<web api key>" \
  -H "Content-Type: application/json" \
  -d '{"postBody":"id_token=invalid&providerId=google.com","requestUri":"https://cocktailflashcards.com","returnSecureToken":true}'
```

## Releasing

Sign-in has two halves that ship on separate schedules, and knowing which half
a change belongs to saves a release cycle:

| Change | How it reaches users |
|---|---|
| Anything under `src/` — the branch in `signIn()`, error handling, `native-auth.js` | **Netlify deploy.** Reaches already-installed apps immediately, since the shell loads the live site. |
| The plugin, `variables.gradle`, `capacitor.config.json`, `google-services.json` | **New Play upload.** Native code can't be delivered by a web deploy. |
| Registering a SHA-1 fingerprint | **Neither.** OAuth clients are validated server-side; an installed app starts working within minutes. |

Adding the plugin needed an upload, and `versionCode` is 6. Everything since has
been JS, delivered by deploy alone.

## Diagnosing a failure

A store-installed app cannot be reached with `chrome://inspect` or `adb logcat`
— and neither can a tester's phone, ever. So the app renders the underlying
error text on screen beneath the summary (`src/App.jsx`), and `native-auth.js`
carries both attempts' messages into it. That on-screen line is the only
diagnostic that reaches anyone, and it is what finally identified this bug.

For a build you installed yourself over `adb`, `chrome://inspect` still gives
you the WebView console, and `adb logcat` the Android-side exception.

| What you see | What it means |
|---|---|
| White screen, no error | The native branch wasn't taken — old JS on the live site, or an install predating the plugin. Check the deployed bundle contains `FirebaseAuthentication`. |
| No picker, `NoClassDefFoundError` | `rgcfaIncludeGoogle` didn't take; the Google libraries are `compileOnly` without it. |
| `10` / `Developer console is not set up correctly` | The running app's certificate matches no registered OAuth client. See the fingerprints above. |
| `account reauth failed` (status 16) | **Also the certificate.** See below. |
| `Cannot find a matching credential` / `NoCredentialException` | No Google account on the device. |
| `12501`, `cancelled by the user` | The person dismissed the picker. Not a fault. |

### "account reauth failed" means the certificate, not the account

This one is worth spelling out, because its wording sends you the wrong way and
the internet will help it. Credential Manager reports an unregistered signing
certificate as `account reauth failed` under status 16 — and 16 is
`CommonStatusCodes.CANCELED`, so the message can also read `16: Canceled`.
Nothing in it mentions certificates.

Search results for it recommend removing and re-adding the Google account and
checking the device clock. That is not the cause here, and following it wastes
time: the same error appeared for a Workspace account and a personal one on the
same phone, which should have been the clue that nothing account-shaped was
involved.

What settled it was the **legacy** path. `signInWithGoogle` defaults to
Credential Manager; `useCredentialManager: false` takes the older Google
Sign-In intent instead, and that one reports Play services' `ApiException`
status codes plainly. It answered `10` — `DEVELOPER_ERROR` — which names the
problem exactly. `native-auth.js` now falls back to it automatically, so both
messages arrive together.

Treat a status code as ambiguous until the phrasing agrees with it. Play
services reuses 16 for a dismissed picker, a missing credential and an
unregistered certificate alike.

## Unrelated, but adjacent

If the **Google Cloud OAuth consent screen** is still in *Testing* publishing
status, only listed test users can sign in; everyone else gets
`Error 403: access_denied`. That's a visible error page, not a white screen, so
it wasn't this bug — but it will bite at production launch.

# Mobile app: AdMob ads + Play Billing (Capacitor)

The Play Store build is a **Capacitor** app: it loads the live site — so
web/content changes still carry over without resubmitting — but adds a native
layer for **AdMob** banner ads and **Google Play Billing** (via **RevenueCat**)
for the one-time "remove ads" purchase.

Web behavior is unchanged: on the web the app still uses AdSense + Stripe. The
native path only activates when the Capacitor plugin bridge is present, detected
in `src/platform.js` as `isCapacitorApp`. (`isPlayApp` is the broader flag that
hides AdSense and Stripe for store-policy reasons; don't gate plugin calls on it.)

**Part 1 is the release walkthrough** — do it in order. **Part 2 is reference** —
how the machinery works once it's running.

## Where things stand

| | |
|---|---|
| App code | ✅ done — `src/monetization.js`, `src/platform.js`, `src/App.jsx` |
| Plugins installed | ✅ `@capacitor-community/admob`, `@revenuecat/purchases-capacitor` + `-ui` |
| `capacitor.config.json` | ✅ app id, `server.url` → the live site with `?platform=play` |
| `android/` native project | ❌ not generated yet — `npx cap add android` has never run |
| Accounts, dashboards, IDs | ❌ all of Part 1 |

---

# Part 1 — Walkthrough

## The ordering trap

Play Console **will not let you create in-app products until you have uploaded an
app bundle** containing the Play Billing library. RevenueCat can't be configured
without that product. So the sequence is *not* "set everything up, then upload":

> **upload a throwaway build → configure the dashboards → test → upload the real
> build.** You will upload at least twice.

A second ordering rule, because the shell loads the live site rather than bundled
files: **deploy the web app to production before every Android build.** If the
deployed JS doesn't contain `monetization.js`, the native plugins have nothing
calling them.

---

## Phase 0 — Lock the package name

`capacitor.config.json` uses `com.cocktailflashcards.app`.

**If a Play Console listing already exists under a different package name,
reconcile that now** — Play treats a different package as an entirely different
app. After your first upload the name is permanent, and the ids you're about to
create in AdMob and RevenueCat are bound to it.

## Phase 1 — Create the accounts

Nothing here depends on code, so it can all happen up front.

1. **Google Play Console** — $25 one-time registration.
2. **AdMob** (admob.google.com) — register the app. You can register it as "not
   yet published on a store" and link it to the Play listing later.
3. **RevenueCat** (revenuecat.com) — create the project.

> **Personal developer accounts** registered since late 2023 must run a closed
> test with a minimum number of testers for a minimum number of days before
> production access unlocks (12 testers / 14 days at time of writing). Check the
> current rule early — it sets your real timeline, and Phase 5 is where you'd
> satisfy it.

## Phase 2 — Generate the native project

Requires **Android Studio** + a JDK.

```bash
npx cap add android      # one-time: creates android/
```

Then two native edits that are easy to miss and both fail loudly-but-late:

1. **AdMob App ID → `AndroidManifest.xml`.** AdMob gives you an App ID
   (`ca-app-pub-…~…`, tilde, distinct from an ad unit id). The Google Mobile Ads
   SDK **crashes on launch** if it's absent, so add it inside `<application>`:

   ```xml
   <meta-data
       android:name="com.google.android.gms.ads.APPLICATION_ID"
       android:value="ca-app-pub-XXXXXXXX~YYYYYYYY"/>
   ```

2. **`launchMode`.** RevenueCat requires the main Activity's `launchMode` to be
   `standard` or `singleTop`, or purchases can be cancelled during Play's
   verification redirect. Check it in the same file.

## Phase 3 — First upload (this is what unlocks everything)

1. Deploy the site to production, so the live JS has `monetization.js` in it.
2. `npm run build && npx cap sync android`
3. `npx cap open android` → **Build → Generate Signed Bundle/APK → Android App
   Bundle**. Create a signing key and **back it up somewhere you won't lose it** —
   with Play App Signing this is your *upload* key, and losing it means asking
   Google to reset it.
4. In Play Console: create the app, then upload the `.aab` to the **internal
   testing** track.

You don't need a finished store listing to upload to internal testing. You *do*
need one before production (Phase 6).

**What this buys you:** the in-app products page unlocks, and your testers get an
install path — purchases can only be tested from a build installed *through
Play*, never from Android Studio's Run button.

## Phase 4 — Configure the dashboards

### 4a. Play Console — the product

Monetize → In-app products → create a **one-time managed product** with id
`lifetime`, set the price, and **activate** it. An inactive product silently
never appears in an Offering.

### 4b. RevenueCat — in this order

The SDK can't work around a gap in any of these.

1. **App.** Add the Android app with package `com.cocktailflashcards.app`, and
   upload the Play service-account credentials so RevenueCat can verify
   purchases.
2. **Entitlement.** Create one whose display name is **Cocktail Flashcards Pro**.
   Copy its **identifier** — the short slug, *not* the display name. Default is
   `cocktail_flashcards_pro`; if yours differs it must change in **both**
   `VITE_REVENUECAT_ENTITLEMENT` and `REVENUECAT_ENTITLEMENT`, or entitlement
   checks silently return false.
3. **Attach** the `lifetime` product to that entitlement.
4. **Offering.** Create one (e.g. `default`), mark it **current**, add a package
   containing `lifetime`. `presentPaywall()` renders the current Offering — no
   package ids are hardcoded in the app.
5. **Paywall.** Design a Paywall on that Offering. Without one,
   `presentPaywall()` returns `NOT_PRESENTED` and the app falls back to buying
   the Offering's first package directly.
6. **API key.** Copy the public **`goog_`** Android key.

### 4c. AdMob — ad unit and consent message

1. Create a **Banner** ad unit → copy its id (`ca-app-pub-…/…`, slash).
2. Privacy & messaging → **GDPR** → create a message, select the app, **publish**.
   Until then `isConsentFormAvailable` is false, no form ever appears, and
   `gatherAdConsent()` fails closed — meaning **no ads at all** in the EEA/UK.
   See [consent.md](consent.md).
3. Optional but worth doing: host `app-ads.txt` at the site root and declare the
   site in AdMob, so your inventory is verifiable to buyers.

### 4d. Set the environment variables

⚠️ **The values that reach users come from Netlify, not your local `.env`.**
Because `server.url` points at the deployed site, the JS running inside the app
is whatever Netlify built. `VITE_*` values in your local `.env` only affect
`npm run dev`.

**Netlify → site → environment variables:**

| var | value |
|---|---|
| `VITE_ADMOB_BANNER_ID` | banner ad unit id (leave blank for test ads) |
| `VITE_REVENUECAT_ANDROID_KEY` | the `goog_` key |
| `VITE_REVENUECAT_ENTITLEMENT` | entitlement identifier |
| `REVENUECAT_ENTITLEMENT` | same value, server side |
| `REVENUECAT_WEBHOOK_SECRET` | see 4e |

### 4e. The webhook — required for web/mobile sync

RevenueCat → Project settings → Integrations → **Webhooks**:

- URL: `https://cocktailflashcards.com/.netlify/functions/revenuecat-webhook`
- Authorization header: a long random string of your choosing

Set that same string as `REVENUECAT_WEBHOOK_SECRET` in Netlify (server-only — no
`VITE_` prefix). Without this, a purchase made in the app never reaches the web.

### 4f. Firestore rules

```bash
firebase deploy --only firestore:rules
```

Editing rules in the Firebase console instead will be silently overwritten by the
next deploy.

## Phase 5 — Test

- **License testers.** Play Console → Setup → License testing → add your Google
  account(s). Their purchases are free and refundable. They must install from the
  internal testing track, signed in as that account.
- **Ads.** Leave `VITE_ADMOB_BANNER_ID` blank until release so Google's built-in
  test banner serves. **Never click real ads while testing** — that's an
  invalidated-traffic ban.
- **The loop that matters:** buy → ads disappear → check the web account is now
  ad-free (proves the webhook) → uninstall → reinstall → **Restore purchase**.
- **Consent form.** You won't see it from outside the EEA. Use
  `debugGeography: AdmobConsentDebugGeography.EEA` plus your device's test id;
  `AdMob.resetConsentInfo()` re-prompts.

### Testing purchases before Play is ready: the Test Store

`VITE_REVENUECAT_TEST_KEY` holds a `test_…` key that simulates purchases with no
Play setup at all. RevenueCat forbids submitting an app configured with one, so
`monetization.js` only uses it when `import.meta.env.DEV` is true, and **refuses
to configure at all** if a `test_` key is found in the production slot.

Since the Android shell loads the deployed site, a production build is exactly
what Play users run — so to exercise the Test Store you must point the shell at
your dev server instead: `capacitor.config.json` → `server.url` =
`http://<your-lan-ip>:5173`, plus `"cleartext": true`, then `npm run dev`.
**Revert both before building a release.**

## Phase 6 — Production release

1. Confirm `VITE_ADMOB_BANNER_ID` is the **real** unit id in Netlify, and
   `VITE_REVENUECAT_ANDROID_KEY` is the `goog_` key (not `test_`).
2. Confirm `capacitor.config.json` points back at
   `https://cocktailflashcards.com/?platform=play` with `cleartext: false`.
3. Deploy the site to production.
4. `npm run build && npx cap sync android`, rebuild the signed `.aab`, bump the
   version code.
5. Complete the Play Console listing: screenshots, description, **privacy policy
   URL** (`https://cocktailflashcards.com/privacy`), content rating, **Data
   safety** form, and the **"contains ads"** declaration — AdMob makes that
   mandatory.
6. Promote through closed/open testing to production.

**After release**, ordinary web deploys reach the app with no resubmission. You
only need a new `.aab` when the native layer changes — plugins, manifest, config,
target SDK bumps.

---

# Part 2 — Reference

## Code already wired up

- `capacitor.config.json` — app id, and `server.url` pointing at
  `https://cocktailflashcards.com/?platform=play` so the app loads the live site
  and trips the Play feature flags.
- `src/platform.js` — `FEATURES.nativeAds` / `FEATURES.nativePurchase` (true only
  in the Play build).
- `src/monetization.js` — AdMob init/consent/banner + RevenueCat
  purchase/restore/entitlement.
- `src/App.jsx` — initializes monetization, shows/hides the banner based on
  ad-free status, and renders a "Remove Ads" + "Restore purchase" block in the
  Play build.

## What the app does with the SDK

| Concern | Where | Notes |
|---|---|---|
| Configure + log level | `initMonetization()` | `LOG_LEVEL.DEBUG` in dev only |
| Live entitlement updates | `onEntitlementChange()` | wraps `addCustomerInfoUpdateListener` — catches purchases made inside the paywall/Customer Center sheets |
| Identity | `linkRevenueCatUser(uid)` | `Purchases.logIn` with the Firebase uid |
| Paywall | `presentPaywall()` | falls back to a direct package purchase |
| Feature gating | `presentPaywallIfNeeded()` | skips the sheet when already entitled |
| Manage purchase | `presentCustomerCenter()` | restore, refunds, support |
| Customer info | `getCustomerInfo()` / `hasProAccess()` | cached by the SDK; cheap to call |
| Cancellation | `isUserCancelled(e)` | RevenueCat rejects on cancel; don't show an error |
| Ad consent | `gatherAdConsent()` | UMP, before `AdMob.initialize()`; fails closed |

## How ad removal + progress stay in sync across web and mobile

Firestore `users/{uid}` is the single source of truth for both. The app keeps a
live `onSnapshot` subscription to that doc, so a change on one platform shows up
on the other while it's open.

| field | writes it | read by |
|---|---|---|
| `progress` | the client, debounced, `merge: true` | every signed-in device |
| `adsRemovedStripe` | `stripe-webhook.mjs`, Admin SDK | — |
| `adsRemovedPlay` | `revenuecat-webhook.mjs`, Admin SDK | — |
| `adsRemoved` | derived union, written by both | every signed-in device |

Ad removal is two independent purchases, so each payment system owns its own
flag and `adsRemoved` is recomputed as their union on every write
(`_entitlements.mjs`). Neither webhook may write `adsRemoved` directly: a Play
refund, expiration, or transfer would otherwise revoke a valid Stripe purchase
made on the web. Documents predating the split have `adsRemoved: true` and no
source flags; those are read as Stripe grants, since nothing else ever set it.

Two details make it work:

- **Identity.** `src/monetization.js` calls `Purchases.logIn(uid)` on sign-in, so
  RevenueCat reports purchases under the Firebase uid and the webhook knows which
  account to mark. This is why the app asks users to sign in before buying —
  a purchase made while signed out lands on an anonymous RevenueCat id and stays
  device-local until they sign in (RevenueCat then sends a `TRANSFER` event,
  which the webhook applies to the account).
- **Union, never overwrite.** `App.jsx` tracks the cloud flag and the on-device
  Play entitlement separately and treats ad-free as either one. A slow Firestore
  read can't revoke a native purchase, and a "no purchase found" restore can't
  revoke a web one.

Clients only ever *read* `adsRemoved` — `firestore.rules` enforces that, so
nobody grants themselves ad removal from the browser console. Client writes to
`users/{uid}` are restricted to `progress` and `updatedAt`; the webhooks write
the entitlement fields through the Admin SDK, which bypasses rules.

## Rebuilding after a change

```bash
npm run build
npx cap sync android     # copies dist/ + refreshes native plugin config
npx cap open android
```

Remember that with `server.url` set, the copied `dist/` isn't what the app
actually loads — the live site is. `cap sync` still matters for native plugin
registration, so run it after any dependency change.

## Troubleshooting

| Symptom | Cause |
|---|---|
| App crashes immediately on launch | AdMob App ID missing from `AndroidManifest.xml` (Phase 2) |
| Paywall never appears, log says `NOT_PRESENTED` | no Offering marked current, or no paywall designed on it |
| "No RevenueCat offering configured" | product not **activated** in Play Console, or not attached to the entitlement |
| Purchase succeeds, app still shows ads | entitlement **identifier** mismatch between the dashboard and `VITE_REVENUECAT_ENTITLEMENT` |
| Purchase works in-app, web still shows ads | webhook not configured, or `REVENUECAT_WEBHOOK_SECRET` mismatch |
| RevenueCat logs "refusing to configure" | a `test_` key is in `VITE_REVENUECAT_ANDROID_KEY` |
| No ads in the EEA/UK, fine elsewhere | no published GDPR message in AdMob → consent fails closed |
| Purchase dialog says "item not available" | testing a build not installed via Play, or account not a license tester |

## Policy reminders

- Ads = **AdMob only** (never AdSense) inside the app.
- Digital purchase = **Play Billing only** (never Stripe) inside the app.
- A **Restore purchase** path is required by Play — it's implemented.
- Consent must come from a Google-certified CMP (UMP) — see [consent.md](consent.md).

# Mobile app: AdMob ads + Play Billing (Capacitor)

The Play Store build is a **Capacitor** app (not the earlier TWA). It loads the
live site — so web/content changes still carry over — but adds a native layer
for **AdMob** banner ads and **Google Play Billing** (via **RevenueCat**) for the
one-time "remove ads" purchase.

Web behavior is unchanged: on the web the app still uses AdSense + Stripe. The
native path only activates when the Capacitor plugin bridge is present, detected
in `src/platform.js` as `isCapacitorApp`. (`isPlayApp` is the broader flag that
hides AdSense and Stripe for store-policy reasons; don't gate plugin calls on it.)

## Code already wired up

- `capacitor.config.json` — app id, and `server.url` pointing at
  `https://cocktailflashcards.com/?platform=play` so the app loads the live site
  and trips the Play feature flags.
- `src/platform.js` — `FEATURES.nativeAds` / `FEATURES.nativePurchase` (true only
  in the Play build).
- `src/monetization.js` — AdMob init/banner + RevenueCat purchase/restore/entitlement.
- `src/App.jsx` — initializes monetization, shows/hides the banner based on
  ad-free status, and renders a "Remove Ads" + "Restore purchase" block in the
  Play build.

## What YOU must set up (accounts + IDs)

### 1. AdMob (ads)
1. Create an AdMob account (admob.google.com) and register the app.
2. Create a **Banner** ad unit → copy its id (`ca-app-pub-…/…`).
3. Put it in `.env` as `VITE_ADMOB_BANNER_ID`. (Leave blank during development to
   serve Google's built-in test banner — **never click real ads while testing**.)
4. AdMob gives you an **App ID** — it must go into the native Android config
   (added automatically when you run the AdMob plugin's setup; see its README) or
   into `AndroidManifest.xml`.

### 2. RevenueCat + Play product (purchase)

The app uses `@revenuecat/purchases-capacitor` (SDK) and
`@revenuecat/purchases-capacitor-ui` (hosted Paywall + Customer Center), both
`13.4.0`. All of it lives in `src/monetization.js`.

**Dashboard setup, in order — the SDK can't work around a gap in any step:**

1. **Product.** Play Console → Monetize → In-app products → create a **one-time
   managed product** with id `lifetime`, set the price, and **activate** it.
   (An inactive product silently never appears in an Offering.)
2. **Project + app.** revenuecat.com → create the project, add the Android app
   with package `com.cocktailflashcards.app`, and upload the Play service-account
   credentials so RevenueCat can verify purchases.
3. **Entitlement.** Create an entitlement whose display name is
   **Cocktail Flashcards Pro**. Copy its **identifier** — the short slug, *not*
   the display name — into `.env` as `VITE_REVENUECAT_ENTITLEMENT` and into the
   Netlify env as `REVENUECAT_ENTITLEMENT`. The default both places is
   `cocktail_flashcards_pro`; if yours differs, both must change or entitlement
   checks silently return false.
4. **Attach** the `lifetime` product to that entitlement.
5. **Offering.** Create an Offering (e.g. `default`), mark it **current**, and add
   a package containing `lifetime`. `presentPaywall()` renders the current
   Offering — no package ids are hardcoded in the app.
6. **Paywall.** In the Offering, design a **Paywall**. Without one,
   `presentPaywall()` returns `NOT_PRESENTED` and the app falls back to buying
   the Offering's first package directly.
7. **API keys.** `VITE_REVENUECAT_ANDROID_KEY` = the public **goog_** key.
8. **Webhook** — see below; required for web/mobile sync.

**Test Store vs production keys.** `VITE_REVENUECAT_TEST_KEY` holds a `test_…`
key, which simulates purchases with no Play setup. RevenueCat forbids submitting
an app configured with one, so `monetization.js` only uses it when
`import.meta.env.DEV` is true, and **refuses to configure at all** if a `test_`
key is found in the production slot. Because the Android shell loads the deployed
site, a production build is exactly what Play users run — so to exercise the Test
Store, point `capacitor.config.json` → `server.url` at your dev server
(`http://<your-lan-ip>:5173`, plus `"cleartext": true`) and run `npm run dev`.
Revert both before building a release.

**Android manifest.** RevenueCat requires the main Activity's `launchMode` to be
`standard` or `singleTop`, or purchases can be cancelled during Play's
verification redirect. Check `android/app/src/main/AndroidManifest.xml` after
`npx cap add android`.

### What the app does with the SDK

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
5. **Webhook (required for web/mobile sync).** RevenueCat → Project settings →
   Integrations → **Webhooks**:
   - URL: `https://cocktailflashcards.com/.netlify/functions/revenuecat-webhook`
   - Authorization header: a long random string of your choosing.
   Set that same string as `REVENUECAT_WEBHOOK_SECRET` in the **Netlify** site's
   environment variables (server-only — no `VITE_` prefix). Without this, a
   purchase made in the app never reaches the web.

## How ad removal + progress stay in sync across web and mobile

Firestore `users/{uid}` is the single source of truth for both. The app keeps a
live `onSnapshot` subscription to that doc, so a change on one platform shows up
on the other while it's open.

| | writes it | read by |
|---|---|---|
| `progress` | the client, debounced, `merge: true` | every signed-in device |
| `adsRemoved` (web purchase) | `stripe-webhook.mjs`, Admin SDK | every signed-in device |
| `adsRemoved` (Play purchase) | `revenuecat-webhook.mjs`, Admin SDK | every signed-in device |

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

Clients only ever *read* `adsRemoved` — keep Firestore rules that way, so nobody
grants themselves ad removal from the browser console.

### 3. Package name
`capacitor.config.json` uses `com.cocktailflashcards.app`. **If you already
created a Play Console listing (e.g. for the TWA), reuse that exact package name
here** — otherwise it's a different app. Change it before the first build; it's
hard to change later.

## Build the Android app

Requires **Android Studio** + JDK installed locally.

```bash
# one-time: generate the native Android project
npx cap add android

# after every web change / env change:
npm run build
npx cap sync android

# open in Android Studio to build a signed release .aab
npx cap open android
```

In Android Studio: **Build → Generate Signed Bundle/APK → Android App Bundle**,
using (and safely backing up) a signing key. Upload the `.aab` to Play Console.

> Deploy ordering: because the app loads the live site, **deploy this branch to
> production first** (so the deployed JS contains `monetization.js`), then build
> the app. Otherwise the native plugins have no JS calling them.

## Testing

- **Ads:** keep `VITE_ADMOB_BANNER_ID` blank (test ads) until release.
- **Purchases:** add your Google account as a **license tester** in Play Console
  (Setup → License testing) so purchases are free/refundable. Test the full
  buy → ads-disappear → uninstall → reinstall → **Restore purchase** loop.

## Policy reminders

- Ads = **AdMob only** (never AdSense) inside the app.
- Digital purchase = **Play Billing only** (never Stripe) inside the app.
- A **Restore purchase** path is required by Play — it's implemented.

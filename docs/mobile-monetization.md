# Mobile app: AdMob ads + Play Billing (Capacitor)

The Play Store build is a **Capacitor** app (not the earlier TWA). It loads the
live site — so web/content changes still carry over — but adds a native layer
for **AdMob** banner ads and **Google Play Billing** (via **RevenueCat**) for the
one-time "remove ads" purchase.

Web behavior is unchanged: on the web the app still uses AdSense + Stripe. The
native path only activates when running inside the Capacitor app, detected in
`src/platform.js` (`isPlayApp`).

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
1. In **Play Console → Monetize → In-app products**, create a **one-time managed
   product**, e.g. id `remove_ads`, and set the price.
2. Create a **RevenueCat** account (revenuecat.com), add the Android app, and
   connect it to Play (upload the Play service-account credentials).
3. In RevenueCat: create an **Entitlement** `remove_ads`, attach the Play product
   to an **Offering**.
4. Put the RevenueCat **public Android SDK key** in `.env` as
   `VITE_REVENUECAT_ANDROID_KEY` (and `VITE_REMOVE_ADS_ENTITLEMENT=remove_ads` if
   you used a different entitlement id).

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

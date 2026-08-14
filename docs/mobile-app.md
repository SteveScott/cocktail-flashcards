# Shipping Cocktail Flashcards to Google Play (TWA)

The app is a PWA that loads the **live** site, so once it's on Play, every web
deploy shows up in the installed app automatically — no resubmission needed.

## What's already in place

- `public/manifest.json` — installable manifest with PNG icons (192, 512, and a
  maskable 512).
- `public/sw.js` — a **network-first** service worker (registered in
  `src/main.jsx`). It prefers the network so web updates always win, and falls
  back to cache only when offline.
- `src/platform.js` — runtime feature flags (`FEATURES`). In the Play build it
  turns **off** AdSense and the Stripe "Remove Ads" purchase (both violate Play
  policy — see below).
- `public/.well-known/assetlinks.json` — Digital Asset Links file, currently a
  template with placeholders to fill in.

## One-time setup

1. **Google Play Console account** — $25 one-time fee.
2. **Icon** is ready (`/icon-512.png`). A 512×512 PNG is all PWABuilder needs.

## Build the Android package

1. Deploy the current site to production (Netlify) so the manifest + service
   worker are live at `https://cocktailflashcards.com`.
2. Go to **https://www.pwabuilder.com**, enter the URL, and let it validate the
   PWA (manifest + service worker should both pass now).
3. Choose **Android → Generate Package**. Important settings:
   - **Host / start URL:** set the launch URL to
     `https://cocktailflashcards.com/?platform=play` so the app trips the
     `FEATURES` flags and hides ads + the Stripe purchase.
   - Note the **package name** it assigns (e.g. `com.cocktailflashcards.twa`).
4. PWABuilder outputs a signed `.aab` plus a `signing-key-info` / `assetlinks`
   snippet containing the **SHA-256 fingerprint**.

## Verify domain ownership (removes the browser URL bar)

1. Fill `public/.well-known/assetlinks.json` with the real **package name** and
   **SHA-256 fingerprint** from PWABuilder.
2. Redeploy so it's live at
   `https://cocktailflashcards.com/.well-known/assetlinks.json`.
3. Without this, the TWA shows a browser address bar. With it, it runs
   full-screen like a native app.

## Submit

1. In Play Console, create the app, upload the `.aab`, fill the store listing
   (screenshots, description, privacy policy URL), and roll out to internal
   testing first, then production.

## Policy notes (already handled by `FEATURES`, but know why)

- **AdSense** is not allowed inside an app webview — the Play build disables it.
  If you want ads in the app, use **AdMob** via a Capacitor plugin instead.
- **Digital purchases** (removing ads) must use **Google Play Billing**, not
  Stripe, inside a Play app. The Play build hides the Stripe purchase. To sell
  ad-removal in-app you'd add Play Billing (easier with Capacitor than a plain
  TWA).

## If you later need native features

Push notifications, Play Billing, etc. aren't available to a plain TWA. At that
point switch the wrapper to **Capacitor** (it can still load the live URL, so
carryover is preserved) and add the native plugins you need. `FEATURES` already
detects Capacitor via `window.Capacitor`, so the flags keep working.

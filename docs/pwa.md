# The web app as a PWA

Cocktail Flashcards is an installable PWA on the web — "Add to Home Screen" on
iOS/Android browsers, "Install" on desktop Chrome/Edge. This is the *web*
delivery path only.

**The Play Store build is separate and does not use any of this to package
itself** — it's a Capacitor app built in Android Studio. See
[mobile-monetization.md](mobile-monetization.md).

## What's in place

- `public/manifest.json` — installable manifest with PNG icons (192, 512, and a
  maskable 512).
- `public/sw.js` — a **network-first** service worker, registered in
  `src/main.jsx` after load so it never blocks first paint.

## Why network-first

The service worker prefers the network and falls back to cache only when
offline. That ordering is deliberate: it means a web deploy is live for
everyone immediately, with no stale-cache window and no waiting for a service
worker update cycle.

It also matters for the Play build. That app loads
`https://cocktailflashcards.com` rather than bundled files, so this same service
worker runs inside its WebView — and cache-first would let a store user sit on
old content indefinitely, with no way to push a fix short of an app update.
Network-first is what makes "deploy the web, the app follows" true.

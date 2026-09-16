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
- `public/pwa-sw.js` — the service worker, registered in `src/main.jsx` after
  load so it never blocks first paint.
- `scripts/pwa-sw.mjs` — a Vite plugin that stamps the copy in `dist` with a
  hash of the build and the list of files to precache. Without it the worker is
  byte-identical on every deploy, and a byte-identical worker never reinstalls.

## Why it isn't at /sw.js

PropellerAds claimed `/sw.js` for a site-ownership file during its brief run as
the ad network, so the PWA worker moved to `/pwa-sw.js`. PropellerAds is gone and
its file with it, but the worker **stays** at `/pwa-sw.js`: every visitor since
the move is registered against that path, and moving back would churn their
offline shell to regain nothing but a conventional filename.

The leftover registration from *before* the move is the part that still matters.
Those visitors have one whose script URL is `/sw.js`, and browsers periodically
re-fetch that URL to check for updates. Nothing is served there now, so leaving
them alone strands a worker this app no longer controls — inside the Play app
too, which loads this same site. `src/main.jsx` therefore unregisters any
`/sw.js` registration before registering the new one. That cleanup should stay
until it's safe to assume no old registrations survive.

## Network-first on the shell, cache-first on the assets

Two rules, and the split is the whole design:

| Request | Rule |
|---|---|
| Navigations — the app shell | Network-first, with a 3 s timeout, then the cached shell |
| Every other same-origin GET | Cache-first |
| `/.netlify/functions/*`, other origins | Untouched |

**The shell asks the network** because it is the only document whose URL does not
change between builds, so it is the one request that can discover there is a
newer app. That ordering is what makes "deploy the web, the app follows" true,
and it matters most for the Play build: that app loads
`https://cocktailflashcards.com` rather than bundled files, so this same worker
runs inside its WebView, and a store user who could sit on an old shell would
have no way to get a fix short of an app update.

**Everything else is served from cache without asking**, and that is safe for a
reason worth stating plainly, because it looks like the opposite of the rule
above: the cache is *named after the build*, and `activate` deletes every cache
that is not the current one. A deploy therefore starts from an empty cache, so a
cache-first hit can never be older than the build the client is running. Within
one build an asset URL is its own content hash, so asking the network whether it
has changed is a round trip that can only answer "no" — and that is exactly the
round trip that hangs when there is no signal.

Do not "fix" the asset branch back to network-first. It was network-first, and
the no-signal behaviour below is what that cost.

## No signal: the timeout, and the zombie colour scheme

Two separate bugs, both fixed here, both worth recognising again if they come
back.

**The long white pause.** Offline is the easy case: `fetch` rejects immediately
and the fallback runs. A tunnel is not offline — the radio is up, the socket
opens, and nothing comes back, so `fetch` neither resolves nor rejects until the
OS gives up tens of seconds later. Under network-first that wait happened once
for the navigation and then again, independently, for every asset the page
needed. `NAV_TIMEOUT_MS` bounds the first; cache-first removes the rest. The
`navigator.onLine === false` check short-circuits genuine airplane mode, and is
only checked for the false case: a phone in a tunnel reports itself online.

**The colour scheme from months ago.** `install` was the only thing that ever
wrote `/index.html` into the cache, and `install` only runs when the worker's
bytes change — which, before `scripts/pwa-sw.mjs`, happened only when somebody
edited it by hand. So a client's offline shell was frozen at whichever build
last touched the worker, and it named that build's hashed CSS and JS, which the
never-evicted `cocktail-cache-v1` still held. The palette lives in
`src/index.css` and `THEMES` in `src/App.jsx`, both hashed, so "old assets"
rendered literally as an old colour scheme.

Two changes keep it current, and both are needed:

1. The build stamp, so a deploy changes the worker's bytes and `install`
   re-precaches this build's shell.
2. A `put` of `/index.html` on every successful load of it, so the shell stays
   current for a client whose worker has not updated yet.

The shell is cached under the fixed key `/index.html`, never under the URL that
was requested. Netlify's SPA rewrite answers `/cocktails/<slug>/` with the app
shell at the recipe's own URL, so keying by request would let any such
navigation overwrite the shell — and every offline launch after that would open
that recipe.

## Testing it

DevTools "Offline" does **not** reproduce any of this: it makes `fetch` reject
at once, so the timeout never fires and the slow path is never taken. Use
request blocking on the origin, or a custom throttling profile with near-zero
throughput, to get a hang rather than a rejection.

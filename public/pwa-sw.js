// The PWA service worker. Also runs inside the Play app's WebView, which loads
// this same site rather than bundled files.
//
// Served from /pwa-sw.js rather than the conventional /sw.js. That path was taken
// by a PropellerAds verification file while it was the ad network; both are gone,
// but the worker stays here rather than moving back, since every visitor since
// the move is registered against this path. See src/main.jsx, which unregisters
// any surviving /sw.js registration from before it.
//
// ── The two rules, and why they differ ──────────────────────────────────────
//
//   Navigations (the app shell)  →  network-first, with a timeout.
//   Every other same-origin GET  →  cache-first.
//
// Network-first on navigations is what keeps "deploy the web, the app follows"
// true: the shell is the only document whose URL does not change between
// builds, so it is the one request that must ask the network whether there is a
// newer app. Nothing can go stale behind it, because a fresh index.html names
// fresh hashed assets.
//
// Cache-first everywhere else is safe for a reason that is easy to lose: CACHE
// is named after the build, and `activate` deletes every cache that is not the
// current one. A deploy therefore starts from an empty cache, so a cache-first
// hit can never be older than the build the client is running. Within one build
// the URL of an asset is its content hash, and asking the network whether a
// content-addressed file has changed is a round trip that can only ever answer
// "no" — which is exactly the round trip that hangs when there is no signal.
const BUILD = "dev"; // @stamp:build
// The offline shell. Rewritten in dist to name this build's hashed entry
// assets; the list below is the `vite dev` fallback. Both stamped lines must
// stay valid JavaScript on their own, because dev serves this file verbatim.
const PRECACHE = ["/", "/index.html", "/manifest.json", "/favicon.svg", "/icon-192.png", "/icon-512.png"]; // @stamp:precache

const CACHE = `cocktail-cache-${BUILD}`;

// How long a navigation waits for the network before the cached shell is served
// instead.
//
// This is not the fix for "offline". An offline fetch rejects immediately and
// never reaches this timeout. It is the fix for having no signal while the radio
// is still up — a tunnel, a lift, a dead spot — where the socket opens and then
// nothing comes back, so fetch neither resolves nor rejects until the OS gives
// up on it tens of seconds later. That wait is the white screen.
//
// The floor is a slow connection that is genuinely working: the shell is a few
// kilobytes of HTML, which is about two seconds on slow 3G. Three leaves
// headroom over that. Below it, a slow train stops fetching the current app and
// starts being served yesterday's shell instead; far above it, the tunnel is
// back to a blank screen. Do not tune this for the tunnel alone.
const NAV_TIMEOUT_MS = 3000;

// The shell is cached under this one key, never under the URL that was
// requested. Netlify's SPA rewrite answers /cocktails/<slug>/ with the app shell
// at the recipe's own URL, so keying by request would let any such navigation
// overwrite the shell with a recipe page — and then every offline launch would
// open that recipe.
const SHELL_KEY = "/index.html";

// Both reads below pass ignoreVary. Netlify sends `Vary: Accept-Encoding` on
// every response, and the Cache API honours it: a request whose encoding header
// does not match the one stored is a MISS, however plainly the entry is there.
// A miss here is not a wrong answer, it is a network fetch — which is the stall
// this file exists to remove, silently reintroduced. Nothing cached here varies
// by anything, so matching on it can only cost.

const rejectAfter = (ms) =>
  new Promise((_, reject) => setTimeout(reject, ms, new Error("sw: network timed out")));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One at a time rather than addAll, which is all-or-nothing: a single
      // entry that 404s would otherwise leave the client with no shell at all.
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only manage same-origin GETs. Let Firebase, Stripe, the ad tag, fonts, etc.
  // go straight to the network untouched.
  if (url.origin !== self.location.origin) return;
  // Same origin, but these are API calls rather than documents: they are
  // authenticated, they have side effects, and a cached answer to one would be
  // wrong by the time it was read.
  if (url.pathname.startsWith("/.netlify/")) return;

  event.respondWith(req.mode === "navigate" ? navigate(event, url) : cacheFirst(req));
});

async function navigate(event, url) {
  const shell = () => caches.match(SHELL_KEY, { cacheName: CACHE, ignoreVary: true });

  // Declared offline: answer from cache without opening a socket at all. Only
  // the false case is worth checking — a phone in a tunnel reports itself
  // online, which is why the timeout below exists and not just this.
  if (!self.navigator.onLine) {
    const hit = await shell();
    if (hit) return hit;
  }

  const net = fetch(event.request).then((res) => {
    // Refresh the shell on every successful load of it. The precache in
    // `install` alone is not enough: it only re-runs when the browser sees
    // different bytes at /pwa-sw.js, and between those it would pin the client
    // to the shell — and so to the hashed CSS and JS, and so to the colour
    // scheme — of whichever build that was.
    if (res && res.ok && (url.pathname === "/" || url.pathname === SHELL_KEY)) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(SHELL_KEY, copy)).catch(() => {});
    }
    return res;
  });
  // The race below can walk away from this promise; keep its rejection handled.
  net.catch(() => {});

  try {
    return await Promise.race([net, rejectAfter(NAV_TIMEOUT_MS)]);
  } catch {
    // Nothing cached and the network is gone: hand back the real request so the
    // browser shows its own network error rather than a blank page.
    return (await shell()) || net;
  }
}

// No timeout on this one, deliberately: everything that BLOCKS a usable screen
// is in PRECACHE, so a miss here is a font (font-display: swap, so a fallback
// face renders meanwhile) or the bar photograph (which sits under a background
// colour that is already correct). Add something blocking to the page without
// adding it to PRECACHE and the tunnel stall comes back, here.
async function cacheFirst(req) {
  const hit = await caches.match(req, { cacheName: CACHE, ignoreVary: true });
  if (hit) return hit;

  const res = await fetch(req);
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

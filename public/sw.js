// Network-first service worker.
//
// The Capacitor Play Store app loads the LIVE site, and this app is also a
// PWA, so we deliberately prefer the network on every request and only fall
// back to cache when offline. That keeps deployed web changes flowing through
// to installed/wrapped clients immediately — no stale precached bundle to fight.
const CACHE = "cocktail-cache-v1";
// Minimal offline shell. Hashed JS/CSS assets get cached on first fetch below.
const SHELL = ["/", "/index.html", "/manifest.json", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  const url = new URL(req.url);

  // Only manage same-origin GETs. Let Firebase, Stripe, the ad tag, fonts, etc.
  // go straight to the network untouched.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // SPA navigations: try network, fall back to the cached app shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Same-origin assets: network-first, cache the fresh copy, fall back to cache.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

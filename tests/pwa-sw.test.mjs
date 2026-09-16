// Run with: npm test
//
// The service worker is the only code here that can show someone an app that is
// months out of date, and it is the hardest to see doing it: every path it takes
// is invisible unless you are offline, in a tunnel, on a device you are not
// holding. This pins the decisions instead.
//
// The worker is loaded into a vm with fakes for the three globals it touches —
// `self`, `caches` and `fetch` — and driven by hand-built fetch events. Plain
// node, no runner, no dependency, same as the rest of tests/.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { SHELL } from "../scripts/pwa-sw.mjs";

const SRC = readFileSync(new URL("../public/pwa-sw.js", import.meta.url), "utf8");
const ORIGIN = "https://cocktailflashcards.com";

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── the fakes ──────────────────────────────────────────────────────────────

// Every response here comes from Netlify, which sends `Vary: Accept-Encoding`
// on all of them — so the fake cache below misses on anything stored unless the
// read passes ignoreVary, exactly as the real Cache API does. Drop that option
// from the worker and most of this file goes red, which is the point: without
// it every cache-first hit quietly becomes a network fetch instead.
class Res {
  constructor(body, ok = true) { this.body = body; this.ok = ok; this.vary = true; }
  clone() { return new Res(this.body, this.ok); }
}

// Cache keys the way the real Cache API does, near enough: a bare path and a
// Request for that path are the same entry, which is what lets the worker store
// the shell as "/index.html" and find it again from a navigation.
const keyOf = (k) => (typeof k === "string" ? k : new URL(k.url).pathname);

function fakeCaches(stores) {
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const cache = (name, fetch) => ({
    put: async (k, res) => { store(name).set(keyOf(k), res); },
    match: async (k) => store(name).get(keyOf(k)),
    add: async (u) => {
      const res = await fetch({ url: ORIGIN + u, method: "GET", mode: "no-cors" });
      if (!res.ok) throw new Error(`add ${u}`);
      store(name).set(keyOf(u), res);
    },
  });
  return (fetch) => ({
    open: async (name) => cache(name, fetch),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (k, opts) => {
      const hit = stores.get(opts.cacheName)?.get(keyOf(k));
      return hit?.vary && !opts.ignoreVary ? undefined : hit;
    },
  });
}

// One worker, loaded fresh, with its network under test control.
//   routes: path -> Res | "hang" (no signal: never settles) | "fail" (rejects)
function load({ routes = {}, stores = new Map(), onLine = true } = {}) {
  const handlers = {};
  const fetched = [];
  const delays = [];
  let pending = 0;

  const fetch = (req) => {
    const path = new URL(typeof req === "string" ? req : req.url).pathname;
    fetched.push(path);
    const r = routes[path] ?? new Res(`net:${path}`);
    if (r === "hang") { pending++; return new Promise(() => {}); }
    if (r === "fail") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(r);
  };

  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    location: { origin: ORIGIN },
    navigator: { onLine },
  };

  // The worker's only timer is the navigation timeout. Record what it asked for
  // — the value is asserted below, so it stays pinned — then fire it fast, so
  // the suite does not spend three real seconds proving a fallback works.
  const timeout = (fn, ms, ...args) => { delays.push(ms); return setTimeout(fn, Math.min(ms, 10), ...args); };

  const ctx = createContext({ self, caches: fakeCaches(stores)(fetch), fetch, URL, console, setTimeout: timeout, clearTimeout });
  runInContext(SRC, ctx);

  const BUILD = runInContext("BUILD", ctx);
  return {
    stores, fetched, delays, BUILD,
    cacheName: runInContext("CACHE", ctx),
    precache: runInContext("PRECACHE", ctx),
    navTimeout: runInContext("NAV_TIMEOUT_MS", ctx),
    stillPending: () => pending,
    setOnLine: (v) => { self.navigator.onLine = v; },
    install: () => { let p; handlers.install({ waitUntil: (x) => { p = x; } }); return p; },
    activate: () => { let p; handlers.activate({ waitUntil: (x) => { p = x; } }); return p; },
    // Returns undefined when the worker declines to handle the request, which
    // is a meaningful answer: the browser goes to the network untouched.
    request: (url, { mode = "no-cors", method = "GET" } = {}) => {
      let answer;
      handlers.fetch({ request: { url: ORIGIN + url, method, mode }, respondWith: (p) => { answer = p; } });
      return answer;
    },
    navigate: (url) => {
      let answer;
      handlers.fetch({ request: { url: ORIGIN + url, method: "GET", mode: "navigate" }, respondWith: (p) => { answer = p; } });
      return answer;
    },
    raw: (url) => {
      let answer;
      handlers.fetch({ request: { url, method: "GET", mode: "no-cors" }, respondWith: (p) => { answer = p; } });
      return answer;
    },
  };
}

// A fallback that never arrives is the bug itself, so bound the wait: the suite
// should print FAIL rather than sit there, which is what happens if the worker
// stops finding what it cached (drop ignoreVary and see).
const within = (p, ms = 200) =>
  Promise.race([p, new Promise((r) => setTimeout(() => r({ body: "<never answered>" }), ms))]);

const shellOf = async (w) => (await w.stores.get(w.cacheName)?.get("/index.html"))?.body;

// ── the cache is named after the build ─────────────────────────────────────
// Everything else here depends on this. A worker whose cache name is a constant
// never evicts, and a worker whose bytes are a constant never reinstalls — which
// together are what froze the offline app at an old build, and its colour scheme
// with it. The dev fallback is "dev"; scripts/pwa-sw.mjs stamps the real one.
{
  const w = load();
  eq("cache is named after the build", w.cacheName, `cocktail-cache-${w.BUILD}`);
  ok("the shell is precached", w.precache.includes("/index.html") && w.precache.includes("/"));
  eq("the navigation timeout is three seconds", w.navTimeout, 3000);
}

// ── install and activate ───────────────────────────────────────────────────
{
  const w = load();
  await w.install();
  eq("install precaches every listed file", [...w.stores.get(w.cacheName).keys()].sort(), [...w.precache].sort());

  const w2 = load({ routes: { "/manifest.json": "fail" } });
  await w2.install();
  ok("one missing file does not cost the whole shell",
    w2.stores.get(w2.cacheName).has("/index.html") && !w2.stores.get(w2.cacheName).has("/manifest.json"));

  const stores = new Map([["cocktail-cache-v1", new Map()], ["cocktail-cache-old", new Map()]]);
  const w3 = load({ stores });
  await w3.install();
  await w3.activate();
  eq("activate drops every cache but this build's", [...stores.keys()], [w3.cacheName]);
}

// ── navigations are network-first ──────────────────────────────────────────
// This is what keeps "deploy the web, the app follows" true, for the Play app's
// WebView as much as for the browser.
{
  const w = load({ routes: { "/": new Res("shell-B") } });
  await w.install();                                    // precached shell-A ("net:/index.html")
  eq("a navigation is answered from the network", (await w.navigate("/")).body, "shell-B");
  eq("and the cached shell is refreshed with it", await shellOf(w), "shell-B");

  // The regression this whole change exists for: without the put above, the
  // cached shell stays at whatever install saw, names that build's hashed CSS
  // and JS, and renders offline in a colour scheme releases out of date.
  w.setOnLine(false);
  eq("so going offline afterwards shows the new build, not the old one",
    (await within(w.navigate("/"))).body, "shell-B");
}

// ── a recipe page must never become the shell ──────────────────────────────
// Netlify's SPA rewrite answers /cocktails/<slug>/ with index.html at the
// recipe's own URL. Keyed by request, that response would overwrite the shell
// and every offline launch after it would open that recipe.
{
  const w = load({ routes: { "/cocktails/negroni/": new Res("negroni-page") } });
  await w.install();
  const before = await shellOf(w);
  eq("a recipe page is still served", (await w.navigate("/cocktails/negroni/")).body, "negroni-page");
  eq("but it does not become the offline shell", await shellOf(w), before);
}

// ── no signal, radio up ────────────────────────────────────────────────────
// The tunnel. fetch neither resolves nor rejects, so the old worker's .catch()
// never ran and the screen stayed white until the OS gave up on the socket.
{
  const routes = {};
  const w = load({ routes });
  await w.install();                                    // cached while there was still signal
  routes["/"] = "hang";                                 // into the tunnel
  eq("a hanging navigation falls back to the cached shell",
    (await within(w.navigate("/"))).body, "net:/index.html");
  eq("without waiting for the network to give up", w.stillPending(), 1);
}

// Declared offline is the easy case, and worth not paying the timeout for.
{
  const w = load({ routes: { "/": new Res("shell") } });
  await w.install();
  w.setOnLine(false);
  const n = w.fetched.length;
  eq("offline serves the shell", (await within(w.navigate("/"))).body, "net:/index.html");
  eq("and asks the network nothing at all", w.fetched.length, n);
}

// Nothing cached and nothing reachable: the browser should show its own error
// page, not a promise that never settles.
{
  const w = load({ routes: { "/": "fail" } });
  let threw = false;
  await w.navigate("/").catch(() => { threw = true; });
  ok("a cold start with no network fails rather than hangs", threw);
}

// ── everything else is cache-first ─────────────────────────────────────────
// Safe only because the cache is per-build: a hit can never predate the build
// the client is running. This is what removes the per-asset wait in a tunnel.
{
  const w = load();
  await w.install();
  const asset = w.precache.find((u) => u.startsWith("/assets/")) ?? "/index.html";
  const n = w.fetched.length;
  eq("a cached asset is served without touching the network", (await w.request(asset)).body, `net:${asset}`);
  eq("no request was made", w.fetched.length, n);

  eq("a miss goes to the network", (await w.request("/fonts/exo2-latin.woff2")).body, "net:/fonts/exo2-latin.woff2");
  await new Promise((r) => setTimeout(r, 0));           // the put is fire-and-forget
  ok("and is cached for next time", w.stores.get(w.cacheName).has("/fonts/exo2-latin.woff2"));
}

// ── what the worker keeps its hands off ────────────────────────────────────
{
  const w = load();
  ok("Netlify functions are left alone", w.request("/.netlify/functions/create-checkout-session") === undefined);
  ok("non-GET is left alone", w.request("/", { method: "POST" }) === undefined);

  ok("cross-origin is left alone", w.raw("https://firestore.googleapis.com/v1/x") === undefined);
  ok("the same path on this origin is not", w.request("/x") !== undefined);
}

// ── the first paint cannot depend on the network ───────────────────────────
// index.html paints a background and a loading mark before the hashed
// stylesheet exists. Every file it names to do that has to be in the precache,
// or the loading screen is itself a request that hangs in a tunnel — the exact
// trap the comment above cacheFirst warns about. /assets/ is exempt because
// scripts/pwa-sw.mjs harvests those from the built index.html; /src/ is the dev
// server only and never shipped.
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const needs = [...new Set([...html.matchAll(/(?:src|href)="(\/[^"]+)"|url\((\/[^)]+)\)/g)]
    .map((m) => m[1] ?? m[2])
    .filter((u) => !u.startsWith("/assets/") && !u.startsWith("/src/")))];

  ok("index.html names something to precache", needs.length > 0);
  eq("and every one of them is in the offline shell", needs.filter((u) => !SHELL.includes(u)), []);
}

console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);

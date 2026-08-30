// Web display ads (PropellerAds).
//
// Replaces AdSense, which rejected the site on content grounds and is not being
// re-enabled. Google Analytics is unaffected and stays — see index.html.
//
// Only in-page formats are used (Native Banner / In-Page Push). Deliberately NOT
// PropellerAds' popunder or browser-push formats: browser push registers its own
// service worker, which would fight public/sw.js and break the PWA's offline
// shell, and popunders/interstitials risk Play's disruptive-ads policy if one
// ever surfaced inside the Capacitor webview.
//
// Config (Vite inlines VITE_* at build time — and because the Capacitor shell
// loads the deployed site, the build that reaches users is NETLIFY'S, so set
// these in the Netlify site's environment variables; a local .env only affects
// `npm run dev`):
//   VITE_PROPELLER_TAG_SRC   Loader URL from the PropellerAds zone snippet.
//                            Account-specific, so it is configured rather than
//                            hardcoded (e.g. //xyz.com/tag.min.js).
//   VITE_PROPELLER_ZONE_ID   Numeric zone id from the same snippet.
//
// With either unset the module is inert and no ad ever loads. That is the
// intended state until the zone exists — a half-configured tag would only
// produce console noise and failed requests.
const TAG_SRC = import.meta.env.VITE_PROPELLER_TAG_SRC || "";
const ZONE_ID = import.meta.env.VITE_PROPELLER_ZONE_ID || "";

const SCRIPT_ID = "propellerads-tag";

export const isAdNetworkConfigured = Boolean(TAG_SRC && ZONE_ID);

export function loadAds() {
  if (!isAdNetworkConfigured) return;
  if (typeof document === "undefined") return;
  if (document.getElementById(SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = TAG_SRC;
  script.async = true;
  script.dataset.zone = ZONE_ID;
  // PropellerAds' snippet ships this: it stops Cloudflare Rocket Loader from
  // deferring the tag, which breaks it. Harmless everywhere else.
  script.dataset.cfasync = "false";
  document.head.appendChild(script);
}

// Best-effort teardown for when someone buys ad removal mid-session, or
// withdraws consent without reloading.
//
// Honest about its limits: removing the tag stops further ad requests, but any
// container the script has already injected is not ours to reason about, so we
// drop the ones it is known to leave behind and let a reload finish the job. The
// real guarantee is the load gate in App.jsx — a paid-up user never fetches this
// script in the first place.
export function unloadAds() {
  if (typeof document === "undefined") return;
  document.getElementById(SCRIPT_ID)?.remove();
  for (const el of document.querySelectorAll(`[data-zone="${ZONE_ID}"], iframe[src*="propeller"]`)) {
    if (el.id !== SCRIPT_ID) el.remove();
  }
}

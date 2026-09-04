// Web display ads (Google AdSense).
//
// AdSense is the web ad network again. PropellerAds was tried in between and is
// gone: its inventory does not permit alcohol and beverage advertising, which is
// the entire subject of this site, so it could never have served a relevant ad.
//
// The tag does two jobs, and the second is the one that dictates how it loads:
//   1. It serves the ads (Auto ads — no <ins> slots are placed by hand).
//   2. It delivers Google's Funding Choices consent message (window.googlefc),
//      the IAB TCF certified CMP that serving ads in the EEA/UK requires.
//
// Because of (2) the tag is deliberately NOT gated on consent — the prompt rides
// in on the very script a consent gate would block. Ads are withheld until the
// user decides by Google's CMP, and the Consent Mode defaults in index.html keep
// storage denied across the EEA/UK/CH meanwhile. See src/consent.js.
//
// Config (Vite inlines VITE_* at build time — and because the Capacitor shell
// loads the deployed site, the build that reaches users is NETLIFY'S, so set
// this in the Netlify site's environment variables; a local .env only affects
// `npm run dev`):
//   VITE_ADSENSE_CLIENT   Publisher id, "ca-pub-…". Defaults to this site's own,
//                         so a normal build needs no configuration at all. Set
//                         it to an EMPTY string to switch web ads off entirely
//                         (useful while the site is pending review) — that is
//                         why an explicitly-set blank wins over the default
//                         rather than falling back to it.
const CONFIGURED_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT;
const ADSENSE_CLIENT = (
  CONFIGURED_CLIENT === undefined ? "ca-pub-3044363631644079" : CONFIGURED_CLIENT
).trim();

// Ad unit ids ("data-ad-slot"), created in the AdSense console under Ads → By ad
// unit. One per placement rather than one shared id, so the dashboard can say
// which placement actually earns and which is only costing layout.
//
// A placement with no id configured renders nothing and takes no space — that is
// the correct state until the units exist, and the switch for turning a
// placement off without touching code.
const AD_SLOTS = {
  menu: import.meta.env.VITE_ADSENSE_SLOT_MENU || "",
  index: import.meta.env.VITE_ADSENSE_SLOT_INDEX || "",
};

const SCRIPT_ID = "adsbygoogle-script";

// Needed on each <ins> as data-ad-client; the script's own ?client= is not
// enough for a manually placed unit.
export const adsenseClient = ADSENSE_CLIENT;

export function adSlotId(placement) {
  return AD_SLOTS[placement] || "";
}

// Whether any ad COULD be served by this build. Necessary for the "Remove Ads"
// card in App.jsx, but not sufficient — see areAdsServing() below.
export const isAdNetworkConfigured = Boolean(ADSENSE_CLIENT);

export function loadAds() {
  if (!isAdNetworkConfigured) return;
  if (typeof document === "undefined") return;
  // The watcher is started on every call, not just the first: the script may
  // already be on the page from an earlier call whose ads hadn't rendered yet.
  watchForServedAds();
  if (document.getElementById(SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
  // Required by Google: without it the tag is fetched opaquely and AdSense
  // cannot report errors back.
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
}

// There is deliberately no unloadAds() counterpart.
//
// Tearing the tag out mid-session would take Funding Choices with it, breaking
// "Privacy & cookie settings" for a user who is still on the page. Nothing needs
// it either: web ad removal goes through Stripe Checkout, which leaves the site
// entirely and returns on a fresh page load (startCheckout in App.jsx sets
// window.location.href), so the load gate below has already re-evaluated by the
// time the buyer sees the app again. A paid-up user never fetches this script.

// ── Is an ad actually on the screen right now? ──────────────────────────────
//
// isAdNetworkConfigured only says a publisher id exists. It is true on every
// normal build, so on its own it would let the "Remove Ads" card offer to remove
// ads that are not there — which is exactly what it looks like today, with the
// tag loading fine against an account AdSense has not yet approved. An unapproved
// account, a site pending review, an ad blocker and an unfilled page all serve
// the script happily and render nothing.
//
// So the card asks this instead, and the answer comes from the page itself.
// AdSense stamps each unit it resolves with data-ad-status="filled" or
// "unfilled"; one filled unit is proof an ad is on screen. Auto ads inject those
// <ins> elements themselves, which is why nothing here places a slot.
//
// This starts false and only ever goes true, so the card stays hidden until an
// ad demonstrably renders. A format that somehow renders without a filled <ins>
// would leave it hidden — that failure direction is deliberate: a missing card
// costs a sale, a card offering to remove nothing reads as a broken button.
const FILLED_AD = 'ins.adsbygoogle[data-ad-status="filled"]';

// Auto ads decide placement after layout, and lazily on scroll for units below
// the fold, so the answer isn't available at load. Watching the whole document
// forever is the cost to avoid; a bounded window is the compromise, long enough
// to cover the initial fill and generous with a slow ad request.
const WATCH_MS = 30000;

let adsServing = false;
let observer = null;
let watchdog = null;
const servingListeners = new Set();

export function areAdsServing() {
  return adsServing;
}

// Subscribe to the transition. Fires at most once, since the value never goes
// back to false. Returns an unsubscribe for effect cleanup.
export function onAdsServing(cb) {
  servingListeners.add(cb);
  return () => servingListeners.delete(cb);
}

function stopWatching() {
  observer?.disconnect();
  observer = null;
  if (watchdog !== null) { clearTimeout(watchdog); watchdog = null; }
}

function checkForFilledAd() {
  if (adsServing || !document.querySelector(FILLED_AD)) return;
  adsServing = true;
  stopWatching();
  for (const cb of servingListeners) {
    try { cb(true); } catch (e) { console.error("ad-serving listener failed", e); }
  }
}

function watchForServedAds() {
  if (adsServing || observer) return;
  if (typeof MutationObserver === "undefined") return;
  // Covers the case where a unit filled before anything subscribed.
  checkForFilledAd();
  if (adsServing) return;
  observer = new MutationObserver(checkForFilledAd);
  // data-ad-status is set on an <ins> that already exists, so attributes matter
  // as much as insertions — watching childList alone would miss every fill.
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-ad-status"],
  });
  watchdog = setTimeout(stopWatching, WATCH_MS);
}

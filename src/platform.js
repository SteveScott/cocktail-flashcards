// Runtime platform detection + feature flags.
//
// The Play Store build (Capacitor) loads the SAME live site as the web, so we
// can't gate features at build time — we detect at runtime whether we're running
// inside the store app and switch off features that violate Play policy there
// (web display ads in-app, and Stripe purchases of digital goods, which Play
// requires to go through Google Play Billing).
//
// How the flag is set:
//   - `window.Capacitor` exists in the native shell, on every in-app navigation.
//   - The shell's launch URL also carries `?platform=play`
//     (capacitor.config.json → server.url), which stands in if the bridge hasn't
//     attached by the time this module is evaluated. Ordinary web visitors never
//     receive that flag.
//
// NOTE: this HIDES features, it isn't a security boundary — the code still
// ships in the bundle. That's the accepted approach for store-policy compliance
// (what matters is how the submitted app behaves).

function detectPlayApp() {
  if (typeof window === "undefined") return false;
  try {
    if (window.Capacitor) return true;
    return new URLSearchParams(window.location.search).get("platform") === "play";
  } catch {
    // location can throw in locked-down webviews — treat as web.
    return false;
  }
}

export const isPlayApp = detectPlayApp();

// Narrower than isPlayApp: is the native plugin bridge actually present?
//
// isPlayApp also answers true on the `?platform=play` URL flag alone, which is
// the right call for hiding the web ad tag and Stripe (better to suppress them a
// moment early than to breach store policy) but the wrong one for anything that
// calls a plugin — that needs the bridge itself, or the call fails.
function detectCapacitorApp() {
  if (typeof window === "undefined") return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  // @capacitor/core defines window.Capacitor in plain web pages too, so ask the
  // bridge whether this is really a native platform rather than trusting the
  // global's presence.
  if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
  if (typeof cap.getPlatform === "function") return cap.getPlatform() !== "web";
  return Boolean(cap.isNative);
}

export const isCapacitorApp = detectCapacitorApp();

export const FEATURES = {
  // Web monetization — only on the web build:
  //   Web display ads (PropellerAds, see src/ads.js) must not run inside the app
  //   webview, where AdMob serves instead and Play's disruptive-ads policy
  //   applies; and selling ad removal via Stripe inside a Play app breaks the
  //   Play Billing requirement for digital goods.
  ads: !isPlayApp,            // web display ads (PropellerAds)
  stripePurchase: !isPlayApp, // web Stripe checkout

  // Native monetization — only where the Capacitor bridge exists:
  //   AdMob banner ads + Google Play Billing (via RevenueCat) for the
  //   ad-removal purchase. Implemented in monetization.js.
  //
  //   Gated on isCapacitorApp, NOT isPlayApp: the URL flag alone can set
  //   isPlayApp without a bridge behind it, and these all call plugins.
  nativeAds: isCapacitorApp,
  nativePurchase: isCapacitorApp,
};

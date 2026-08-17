// Runtime platform detection + feature flags.
//
// The Play Store build (TWA or Capacitor) loads the SAME live site as the web,
// so we can't gate features at build time — we detect at runtime whether we're
// running inside the store app and switch off features that violate Play policy
// there (AdSense-in-app, and Stripe purchases of digital goods, which Play
// requires to go through Google Play Billing).
//
// How the flag is set:
//   - Capacitor: `window.Capacitor` always exists in the native shell.
//   - TWA: configure the app's launch URL as `https://<site>/?platform=play`
//     (PWABuilder/Bubblewrap set this independently of the web manifest, so
//     ordinary web visitors never receive the flag).
//   - Either way we persist it so it survives in-app navigation.
//
// NOTE: this HIDES features, it isn't a security boundary — the code still
// ships in the bundle. That's the accepted approach for store-policy compliance
// (what matters is how the submitted app behaves).

function detectPlayApp() {
  if (typeof window === "undefined") return false;
  try {
    if (window.Capacitor) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("platform") === "play") {
      localStorage.setItem("platform", "play");
      return true;
    }
    if (document.referrer.startsWith("android-app://")) {
      localStorage.setItem("platform", "play");
      return true;
    }
    if (localStorage.getItem("platform") === "play") return true;
  } catch {
    // localStorage/referrer can throw in locked-down webviews — treat as web.
  }
  return false;
}

export const isPlayApp = detectPlayApp();

// Narrower than isPlayApp: are we running inside the Capacitor shell, where the
// native plugin bridge actually exists?
//
// isPlayApp is deliberately broad — it also matches the legacy TWA build via the
// query string, the referrer, and the persisted localStorage flag. That's right
// for store-policy gating (a TWA must hide AdSense and Stripe just the same),
// but wrong for anything that calls a plugin: a TWA is a Chrome tab with no
// bridge, so AdMob and RevenueCat calls there fail, and offering their UI leaves
// TWA users a purchase button that cannot work while Stripe is hidden from them.
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
  //   AdSense-for-content inside an app webview violates AdSense program policy,
  //   and selling ad removal via Stripe inside a Play app breaks the Play
  //   Billing requirement for digital goods.
  ads: !isPlayApp,            // web AdSense
  stripePurchase: !isPlayApp, // web Stripe checkout

  // Native monetization — only where the Capacitor bridge exists:
  //   AdMob banner ads + Google Play Billing (via RevenueCat) for the
  //   ad-removal purchase. Implemented in monetization.js.
  //
  //   Gated on isCapacitorApp, NOT isPlayApp: a legacy TWA install trips
  //   isPlayApp but has no plugins, so these must stay off there.
  nativeAds: isCapacitorApp,
  nativePurchase: isCapacitorApp,
};

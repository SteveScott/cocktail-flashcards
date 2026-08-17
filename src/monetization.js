// Native monetization for the Play Store (Capacitor) build: AdMob banner ads +
// Google Play Billing (via RevenueCat) for the one-time "remove ads" purchase.
//
// Everything here is a no-op unless we're running inside the Capacitor app
// (see isPlayApp). Plugins are dynamically imported so their native-only code
// never loads for web visitors.
//
// Required config — set these in a .env file BEFORE building the Play app
// (Vite inlines VITE_* at build time):
//   VITE_ADMOB_BANNER_ID        AdMob banner ad unit id (ca-app-pub-…/…)
//   VITE_REVENUECAT_ANDROID_KEY RevenueCat public Android SDK key
//   VITE_REMOVE_ADS_ENTITLEMENT RevenueCat entitlement id (default "remove_ads")
import { isPlayApp } from "./platform";

// Google's official TEST banner id — safe to ship as a fallback; it only serves
// test ads. Replace via VITE_ADMOB_BANNER_ID for the real release.
const ADMOB_BANNER_ID = import.meta.env.VITE_ADMOB_BANNER_ID || "ca-app-pub-3940256099942544/6300978111";
const REVENUECAT_API_KEY = import.meta.env.VITE_REVENUECAT_ANDROID_KEY || "";
const ENTITLEMENT = import.meta.env.VITE_REMOVE_ADS_ENTITLEMENT || "remove_ads";

let initialized = false;

// Initialize the ad + billing SDKs and report whether this user already owns the
// ad-removal entitlement. Call once on app start.
export async function initMonetization() {
  if (!isPlayApp || initialized) return { adsRemoved: false };
  initialized = true;
  let adsRemoved = false;
  try {
    const { AdMob } = await import("@capacitor-community/admob");
    await AdMob.initialize({});
  } catch (e) { console.error("AdMob init failed", e); }
  try {
    if (REVENUECAT_API_KEY) {
      const { Purchases } = await import("@revenuecat/purchases-capacitor");
      await Purchases.configure({ apiKey: REVENUECAT_API_KEY });
      adsRemoved = await hasRemovedAds();
    }
  } catch (e) { console.error("RevenueCat init failed", e); }
  return { adsRemoved };
}

export async function showBanner() {
  if (!isPlayApp) return;
  try {
    const { AdMob, BannerAdPosition, BannerAdSize } = await import("@capacitor-community/admob");
    await AdMob.showBanner({
      adId: ADMOB_BANNER_ID,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
    });
  } catch (e) { console.error("showBanner failed", e); }
}

export async function hideBanner() {
  if (!isPlayApp) return;
  try {
    const { AdMob } = await import("@capacitor-community/admob");
    await AdMob.removeBanner();
  } catch (e) { console.error("hideBanner failed", e); }
}

// True if the signed-in Play user owns the ad-removal entitlement.
export async function hasRemovedAds() {
  if (!isPlayApp || !REVENUECAT_API_KEY) return false;
  try {
    const { Purchases } = await import("@revenuecat/purchases-capacitor");
    const { customerInfo } = await Purchases.getCustomerInfo();
    return Boolean(customerInfo.entitlements.active[ENTITLEMENT]);
  } catch (e) { console.error("entitlement check failed", e); return false; }
}

// Launch the Play Billing purchase flow. Resolves true once the entitlement is
// active. Throws if no offering is configured or the SDK errors (callers should
// catch — user cancellation also rejects).
export async function purchaseRemoveAds() {
  if (!isPlayApp || !REVENUECAT_API_KEY) return false;
  const { Purchases } = await import("@revenuecat/purchases-capacitor");
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages?.[0];
  if (!pkg) throw new Error("No RevenueCat offering configured");
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return Boolean(customerInfo.entitlements.active[ENTITLEMENT]);
}

// Restore a previous purchase (required by Play — users who reinstall or switch
// devices must be able to get their ad-removal back without paying again).
export async function restorePurchases() {
  if (!isPlayApp || !REVENUECAT_API_KEY) return false;
  const { Purchases } = await import("@revenuecat/purchases-capacitor");
  const { customerInfo } = await Purchases.restorePurchases();
  return Boolean(customerInfo.entitlements.active[ENTITLEMENT]);
}

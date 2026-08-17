// Native monetization for the Play Store (Capacitor) build: AdMob banner ads +
// Google Play Billing (via RevenueCat) for the "Cocktail Flashcards Pro"
// entitlement, which is what removes ads.
//
// Everything here is a no-op unless the Capacitor plugin bridge is present (see
// isCapacitorApp — deliberately narrower than isPlayApp, which can be set by the
// URL flag alone). Plugins are dynamically imported so their native-only code
// never loads for web visitors.
//
// Required config — set these in a .env file BEFORE building the Play app
// (Vite inlines VITE_* at build time):
//   VITE_ADMOB_BANNER_ID         AdMob banner ad unit id (ca-app-pub-…/…)
//   VITE_REVENUECAT_ANDROID_KEY  RevenueCat public Android SDK key (goog_…)
//   VITE_REVENUECAT_TEST_KEY     RevenueCat Test Store key (test_…), dev only
//   VITE_REVENUECAT_ENTITLEMENT  Entitlement identifier (default cocktail_flashcards_pro)
import { isCapacitorApp } from "./platform";

// Google's official TEST banner id — safe to ship as a fallback; it only serves
// test ads. Replace via VITE_ADMOB_BANNER_ID for the real release.
const ADMOB_BANNER_ID = import.meta.env.VITE_ADMOB_BANNER_ID || "ca-app-pub-3940256099942544/6300978111";

const PROD_KEY = import.meta.env.VITE_REVENUECAT_ANDROID_KEY || "";
const TEST_KEY = import.meta.env.VITE_REVENUECAT_TEST_KEY || "";
// VITE_REMOVE_ADS_ENTITLEMENT is the pre-Pro name for this setting — still read
// so an existing .env keeps working.
export const ENTITLEMENT =
  import.meta.env.VITE_REVENUECAT_ENTITLEMENT ||
  import.meta.env.VITE_REMOVE_ADS_ENTITLEMENT ||
  "cocktail_flashcards_pro";

// The Test Store simulates purchases with no Play setup, but RevenueCat is
// explicit that a test_ key must NEVER reach a submitted app. The Capacitor
// shell loads the deployed site (capacitor.config.json → server.url), so a
// production bundle is exactly what Play users run: refuse the test key there
// rather than trusting ourselves to swap it before release. To use the Test
// Store, point server.url at the Vite dev server (see docs/mobile-monetization.md).
const IS_DEV = import.meta.env.DEV;
function resolveApiKey() {
  if (IS_DEV && TEST_KEY) return TEST_KEY;
  if (PROD_KEY.startsWith("test_")) {
    console.error(
      "RevenueCat: refusing to configure — VITE_REVENUECAT_ANDROID_KEY holds a Test Store key (test_…). " +
      "Set the production goog_… key before building for Play."
    );
    return "";
  }
  return PROD_KEY;
}
const REVENUECAT_API_KEY = resolveApiKey();

// Fanned out to React on every CustomerInfo change (see configurePurchases).
const entitlementListeners = new Set();

// AdMob's shared initialization, same pattern as configurePromise below and for
// the same reason: the banner effect in App.jsx fires as soon as the ad-free
// check settles, which can be while AdMob.initialize() is still in flight. A
// showBanner() that went straight to the plugin would fail against an
// uninitialized SDK, log once, and never be retried — the effect's dependencies
// don't change again, so the user would simply never see a banner.
let adMobPromise = null;

function ensureAdMob() {
  if (!isCapacitorApp) return Promise.resolve(false);
  if (!adMobPromise) {
    adMobPromise = (async () => {
      try {
        const { AdMob } = await import("@capacitor-community/admob");
        await AdMob.initialize({});
        return true;
      } catch (e) {
        console.error("AdMob init failed", e);
        return false;
      }
    })().then(ok => {
      // Don't cache a failure — the next banner call gets a fresh attempt.
      if (!ok) adMobPromise = null;
      return ok;
    });
  }
  return adMobPromise;
}

async function loadPurchases() {
  const { Purchases } = await import("@revenuecat/purchases-capacitor");
  return Purchases;
}

// The single in-flight (then settled) configuration attempt. Every entry point
// below awaits it.
//
// A plain `configured` boolean raced: whoever called first won, and a caller
// that arrived a moment early — auth resolving before startup finished, say —
// would silently no-op and never retry, because nothing re-triggers it. Worst
// case that stranded the session on the anonymous RevenueCat id, leaving the
// webhook no uid to attribute a purchase to. Sharing one promise makes call
// order irrelevant: the first caller starts configuration, everyone else waits
// for that same attempt.
let configurePromise = null;

async function configurePurchases() {
  try {
    const Purchases = await loadPurchases();
    if (IS_DEV) {
      const { LOG_LEVEL } = await import("@revenuecat/purchases-capacitor");
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    }
    // No appUserID here: at startup we usually don't know the Firebase uid yet.
    // linkRevenueCatUser() attaches it as soon as auth resolves.
    await Purchases.configure({ apiKey: REVENUECAT_API_KEY });
    await Purchases.addCustomerInfoUpdateListener((customerInfo) => emit(customerInfo));
    return true;
  } catch (e) {
    console.error("RevenueCat configure failed", e);
    return false;
  }
}

// Resolves true once the SDK is usable. Safe to call from anywhere, any number
// of times.
function ensureConfigured() {
  if (!isBillingAvailable()) return Promise.resolve(false);
  if (!configurePromise) {
    configurePromise = configurePurchases().then(ok => {
      // Don't cache a failure forever — a later call gets a fresh attempt.
      if (!ok) configurePromise = null;
      return ok;
    });
  }
  return configurePromise;
}

// RevenueCat is available (Play build, configured with a usable key).
export function isBillingAvailable() {
  return isCapacitorApp && Boolean(REVENUECAT_API_KEY);
}

function isActive(customerInfo) {
  return Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT]);
}

function emit(customerInfo) {
  const active = isActive(customerInfo);
  for (const cb of entitlementListeners) {
    try { cb(active, customerInfo); } catch (e) { console.error("entitlement listener failed", e); }
  }
}

// Subscribe to entitlement changes. Returns an unsubscribe function.
//
// This is the piece that keeps the UI honest: a purchase can complete inside
// the paywall or Customer Center sheet, a subscription can lapse, or a purchase
// can transfer between accounts — all without any call of ours returning. The
// SDK's CustomerInfo listener reports every one of those.
export function onEntitlementChange(cb) {
  entitlementListeners.add(cb);
  return () => entitlementListeners.delete(cb);
}

// Initialize the ad + billing SDKs and report whether this user already owns
// Pro. Call on app start — but nothing else has to wait for it, since every
// entry point drives configuration itself via ensureConfigured().
export async function initMonetization() {
  if (!isCapacitorApp) return { adsRemoved: false };

  await ensureAdMob();
  if (!(await ensureConfigured())) return { adsRemoved: false };
  return { adsRemoved: await hasProAccess() };
}

export async function showBanner() {
  if (!(await ensureAdMob())) return;
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
  if (!(await ensureAdMob())) return;
  try {
    const { AdMob } = await import("@capacitor-community/admob");
    await AdMob.removeBanner();
  } catch (e) { console.error("hideBanner failed", e); }
}

// ── Customer info ───────────────────────────────────────────────────────
// Safe to call often: the SDK caches CustomerInfo and refreshes it when the app
// becomes active, so this usually resolves without a network round trip.
export async function getCustomerInfo() {
  if (!(await ensureConfigured())) return null;
  try {
    const Purchases = await loadPurchases();
    const { customerInfo } = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch (e) { console.error("getCustomerInfo failed", e); return null; }
}

// True if this device's RevenueCat user owns the Pro entitlement.
export async function hasProAccess() {
  return isActive(await getCustomerInfo());
}

// Kept under the old name so existing callers keep reading well — ad removal is
// what the Pro entitlement grants.
export const hasRemovedAds = hasProAccess;

// ── Identity ────────────────────────────────────────────────────────────
// Tie the RevenueCat identity to the Firebase uid, so an entitlement bought in
// the Play app is attached to the same account the web signs in with. This is
// what makes cross-platform sync possible at all: the RevenueCat webhook reports
// purchases under this app-user id, and the server writes `adsRemoved` on the
// matching users/{uid} doc. Without it, purchases live under an anonymous
// ($RCAnonymousID:…) id the web has no way to resolve.
export async function linkRevenueCatUser(uid) {
  if (!uid || !(await ensureConfigured())) return false;
  try {
    const Purchases = await loadPurchases();
    const { customerInfo } = await Purchases.logIn({ appUserID: uid });
    emit(customerInfo);
    return isActive(customerInfo);
  } catch (e) { console.error("RevenueCat logIn failed", e); return false; }
}

// Detach on sign-out. RevenueCat falls back to an anonymous id, which may still
// own an entitlement purchased before the user ever signed in — so report what
// that id actually owns rather than assuming false.
export async function unlinkRevenueCatUser() {
  if (!(await ensureConfigured())) return false;
  try {
    const Purchases = await loadPurchases();
    // logOut rejects when the current id is already anonymous, which is exactly
    // the state at startup before anyone signs in — and this now runs then,
    // where the old configure race used to swallow it. Nothing to detach, so
    // just report what the anonymous id owns.
    const anon = await Purchases.isAnonymous().catch(() => null);
    if (anon?.isAnonymous) return isActive(await getCustomerInfo());
    const { customerInfo } = await Purchases.logOut();
    emit(customerInfo);
    return isActive(customerInfo);
  } catch (e) { console.error("RevenueCat logOut failed", e); return false; }
}

// ── Offerings & purchasing ──────────────────────────────────────────────
// The current Offering, whose packages are what the paywall renders. Returns
// null when none is configured — a dashboard problem, not a user error.
export async function getCurrentOffering() {
  if (!(await ensureConfigured())) return null;
  try {
    const Purchases = await loadPurchases();
    const offerings = await Purchases.getOfferings();
    return offerings.current || null;
  } catch (e) { console.error("getOfferings failed", e); return null; }
}

// RevenueCat rejects on user cancellation just like on a real failure. Callers
// must not show an error for a deliberate back-out.
export function isUserCancelled(e) {
  return Boolean(e?.userCancelled) || e?.code === "1" || e?.code === 1 ||
    /cancel/i.test(e?.message || "");
}

// What came of showing the paywall. Callers need these apart: "the user said no"
// and "there was no paywall to show" both mean not-entitled, but only the second
// justifies falling back to a direct purchase — doing that after a cancellation
// would shove a Play purchase dialog at someone who just backed out.
export const PAYWALL_OUTCOME = {
  PURCHASED: "purchased",
  CANCELLED: "cancelled",
  UNAVAILABLE: "unavailable",
  ERROR: "error",
};

// Present the RevenueCat-hosted paywall (configured in the dashboard, so pricing
// and copy change without an app release). Prefer this over a hand-rolled
// purchase button.
export async function presentPaywall() {
  if (!(await ensureConfigured())) return PAYWALL_OUTCOME.UNAVAILABLE;
  const { RevenueCatUI } = await import("@revenuecat/purchases-capacitor-ui");
  const { PAYWALL_RESULT } = await import("@revenuecat/purchases-capacitor");
  const { result } = await RevenueCatUI.presentPaywall();
  switch (result) {
    case PAYWALL_RESULT.PURCHASED:
    case PAYWALL_RESULT.RESTORED:
      return PAYWALL_OUTCOME.PURCHASED;
    case PAYWALL_RESULT.NOT_PRESENTED:
      // Nothing to show — almost always a missing Offering or no paywall
      // attached to it in the dashboard.
      console.error("Paywall not presented — check the Offering + paywall config");
      return PAYWALL_OUTCOME.UNAVAILABLE;
    case PAYWALL_RESULT.CANCELLED:
      return PAYWALL_OUTCOME.CANCELLED;
    default:
      return PAYWALL_OUTCOME.ERROR;
  }
}

// Same, but the SDK skips the paywall when the entitlement is already active —
// the right call for gating a Pro feature at the point of use.
export async function presentPaywallIfNeeded() {
  if (!(await ensureConfigured())) return false;
  const { RevenueCatUI } = await import("@revenuecat/purchases-capacitor-ui");
  const { PAYWALL_RESULT } = await import("@revenuecat/purchases-capacitor");
  const { result } = await RevenueCatUI.presentPaywallIfNeeded({
    requiredEntitlementIdentifier: ENTITLEMENT,
  });
  return result === PAYWALL_RESULT.PURCHASED
    || result === PAYWALL_RESULT.RESTORED
    || result === PAYWALL_RESULT.NOT_PRESENTED; // already entitled
}

// Customer Center: RevenueCat's built-in "manage my purchase" sheet — restore,
// refund requests, subscription management, support. Play requires a restore
// path, and this provides it plus the self-service flows that otherwise become
// support email.
export async function presentCustomerCenter() {
  if (!(await ensureConfigured())) return false;
  try {
    const { RevenueCatUI } = await import("@revenuecat/purchases-capacitor-ui");
    await RevenueCatUI.presentCustomerCenter();
    // The sheet can change entitlement state (restore, refund) without telling
    // us directly — re-read so the UI settles on the truth. The CustomerInfo
    // listener normally fires too; this makes it deterministic.
    return await hasProAccess();
  } catch (e) { console.error("presentCustomerCenter failed", e); return false; }
}

// Direct purchase of the first package in the current Offering — the fallback
// for when no paywall is configured in the dashboard. Throws so callers can
// distinguish cancellation from failure via isUserCancelled().
export async function purchaseRemoveAds() {
  if (!(await ensureConfigured())) return false;
  const Purchases = await loadPurchases();
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages?.[0];
  if (!pkg) throw new Error("No RevenueCat offering configured");
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return isActive(customerInfo);
}

// Restore a previous purchase (required by Play — users who reinstall or switch
// devices must be able to get their Pro access back without paying again).
export async function restorePurchases() {
  if (!(await ensureConfigured())) return false;
  const Purchases = await loadPurchases();
  const { customerInfo } = await Purchases.restorePurchases();
  emit(customerInfo);
  return isActive(customerInfo);
}

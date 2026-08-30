// Web ad + analytics consent, self-hosted.
//
// This used to be glue around Google Funding Choices (`window.googlefc`), which
// arrived with the AdSense tag — and left with it when the site moved to
// PropellerAds. PropellerAds ships no consent UI, so the choice is collected by
// our own banner (see ConsentBanner in App.jsx) and this module is the state
// behind it.
//
// Two jobs, and the second is easy to overlook:
//   1. Gate the PropellerAds tag, which must not load before consent in scope.
//   2. Tell Google Consent Mode what the user chose. index.html defaults
//      `analytics_storage` to DENIED across the EEA/UK/CH, and the only thing
//      that ever flipped it to granted was Google's own message. Without this
//      update call, keeping Google Analytics would mean losing every European
//      visitor from it, permanently.

const STORAGE_KEY = "cocktail_consent_v1";

// Whether this visitor is in the region whose rules require asking first.
//
// Google resolves this server-side by IP for its own tags (the region list in
// index.html), but our banner runs client-side and has no geo lookup, so it
// goes by the browser's IANA time zone. That deliberately over-includes:
// "Europe/*" also covers Russia, Türkiye, Serbia and other non-EEA countries.
// Showing a consent banner to someone who didn't need one is harmless; skipping
// it for someone who did is not, so the error is biased that way on purpose.
//
// It can still under-detect — a VPN, or a traveller whose device clock says
// America/New_York. Those users are then treated as out of scope by the banner,
// while Google's own region-scoped defaults keep their analytics storage denied
// by IP regardless. The failure mode is lost analytics, never an unconsented
// tag, which is the right way round.
const IN_SCOPE_ZONES = /^(Europe\/|Atlantic\/(Canary|Madeira|Azores|Faroe|Reykjavik)|Arctic\/Longyearbyen)/;

function detectConsentRequired() {
  if (typeof window === "undefined") return false;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return IN_SCOPE_ZONES.test(tz);
  } catch {
    // No Intl, or a locked-down webview. Ask rather than assume out of scope.
    return true;
  }
}

// Resolved once per page load — the time zone can't change mid-session, and a
// stable value keeps the banner from appearing and vanishing between renders.
export const consentRequired = detectConsentRequired();

// localStorage throws outright in some privacy modes rather than returning null,
// so every access is wrapped. A visitor whose browser refuses storage simply
// gets asked again next time, which is the correct fallback.
function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch { return null; }
}

function writeStored(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* nothing we can do */ }
}

let decision = readStored();

const listeners = new Set();

function emit() {
  for (const cb of listeners) {
    try { cb(getConsentState()); } catch (e) { console.error("consent listener failed", e); }
  }
}

// Push the choice into Google Consent Mode. `window.gtag` is defined by the
// inline block in index.html, which runs before this module, so it is normally
// present — but the tag can be blocked by an extension, hence the guard.
function updateGoogleConsent(granted) {
  const gtag = typeof window !== "undefined" ? window.gtag : undefined;
  if (typeof gtag !== "function") return;
  const value = granted ? "granted" : "denied";
  gtag("consent", "update", {
    ad_storage: value,
    ad_user_data: value,
    ad_personalization: value,
    analytics_storage: value,
  });
}

// The banner is owed to visitors in scope who haven't answered yet. Out of
// scope, index.html has already defaulted everything to granted and there is
// nothing to ask.
export function needsConsentDecision() {
  return consentRequired && decision === null;
}

// May the ad tag load? Out of scope: yes. In scope: only on an explicit grant —
// an undecided visitor is treated exactly like a refusal until they choose.
export function adsAllowed() {
  return !consentRequired || decision === "granted";
}

export function getConsentState() {
  return { required: consentRequired, decision, adsAllowed: adsAllowed(), needsDecision: needsConsentDecision() };
}

// Replay a stored grant into Consent Mode on startup. Without this, a returning
// European visitor who accepted last week would load with the denied defaults
// from index.html still in force.
export function initConsent() {
  if (!consentRequired) return;
  if (decision !== null) updateGoogleConsent(decision === "granted");
}

export function setConsent(granted) {
  decision = granted ? "granted" : "denied";
  writeStored(decision);
  updateGoogleConsent(granted);
  emit();
}

// Reopen the choice. GDPR requires withdrawing consent to be as easy as giving
// it, so this clears the decision and lets the banner come back rather than
// silently flipping the value.
export function openPrivacySettings() {
  decision = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing we can do */ }
  // Re-deny until the new choice is made, so a tag can't keep running on the
  // strength of a grant the user is in the middle of revoking.
  updateGoogleConsent(false);
  emit();
  return true;
}

export function onConsentChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

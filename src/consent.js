// Web consent for advertising and analytics cookies.
//
// Under the ePrivacy Directive these must not load until the user has agreed,
// so consent gates the AdSense script (src/App.jsx) and drives Google Consent
// Mode v2 signals for Analytics. index.html sets every consent type to "denied"
// before gtag runs; this module is what later grants it.
//
// Scope note: this satisfies "nothing loads before consent" and signals Consent
// Mode correctly. Google additionally requires a *certified* CMP (IAB TCF) to
// serve ads to EEA/UK users — see docs/consent.md. The Android app uses Google's
// own UMP SDK, which is certified; the web still needs that piece.
const STORAGE_KEY = "consent_v1";
const GRANTED = "granted";
const DENIED = "denied";

const listeners = new Set();

// "granted" | "denied" | null (never asked)
export function getConsent() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === GRANTED || v === DENIED ? v : null;
  } catch {
    // Private mode / locked-down webview: treat as unanswered, and since we
    // can't persist a choice we'll simply ask again next time.
    return null;
  }
}

export function hasConsented() {
  return getConsent() === GRANTED;
}

// True when we still owe the user a choice.
export function needsConsentChoice() {
  return getConsent() === null;
}

// Tell Google what the user decided. Consent Mode expects all four v2 signals;
// omitting any leaves it at the denied default from index.html.
function signalConsentMode(granted) {
  const value = granted ? GRANTED : DENIED;
  try {
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        ad_storage: value,
        ad_user_data: value,
        ad_personalization: value,
        analytics_storage: value,
      });
    }
  } catch (e) { console.error("consent update failed", e); }
}

export function setConsent(granted) {
  try { localStorage.setItem(STORAGE_KEY, granted ? GRANTED : DENIED); } catch { /* not persistable */ }
  signalConsentMode(granted);
  for (const cb of listeners) {
    try { cb(granted); } catch (e) { console.error("consent listener failed", e); }
  }
}

// Reopen the choice — needed so users can withdraw consent as easily as they
// gave it, which GDPR requires.
export function resetConsent() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* not persistable */ }
  signalConsentMode(false);
  for (const cb of listeners) {
    try { cb(false); } catch (e) { console.error("consent listener failed", e); }
  }
}

export function onConsentChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

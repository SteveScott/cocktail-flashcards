// Web ad/analytics consent, delegated to Google's own consent management.
//
// The GDPR message is configured in the AdSense console (Privacy & messaging)
// and delivered by the AdSense tag itself, which is why the ad script must be
// allowed to load for EEA/UK users — the message rides along with it. Google's
// CMP is IAB TCF certified, which is what serving ads in the EEA/UK requires and
// what a hand-rolled banner could not satisfy.
//
// Consent Mode defaults live in index.html and are region-scoped: denied across
// the EEA/UK/CH until Google's message resolves them, granted elsewhere.
//
// This module is only the glue for letting users revisit that choice, which
// GDPR requires to be as easy as giving it.

function fc() {
  return typeof window !== "undefined" ? window.googlefc : undefined;
}

// Reopen Google's consent message. Clears the stored EU consent record and shows
// the message again so the user can change or withdraw their decision.
export function openPrivacySettings() {
  const g = fc();
  if (typeof g?.showRevocationMessage === "function") {
    g.showRevocationMessage();
    return true;
  }
  // Not loaded — the tag is blocked, or no message is published yet.
  console.error("Google consent message unavailable (googlefc.showRevocationMessage missing)");
  return false;
}

// Report whether GDPR applies to this visitor, so the settings link is shown
// only to the users it's meaningful for. Google answers this via the TCF API
// once its consent framework is ready; users outside scope never get a callback
// with gdprApplies true, so the link simply stays hidden.
//
// Fires again whenever the user changes their selections.
export function onGdprApplicable(cb) {
  if (typeof window === "undefined") return;
  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
  window.googlefc.callbackQueue.push({
    CONSENT_API_READY: () => {
      try {
        window.__tcfapi("addEventListener", 2.2, (tcData, success) => {
          cb(Boolean(success && tcData?.gdprApplies));
        });
      } catch (e) {
        console.error("TCF addEventListener failed", e);
        cb(false);
      }
    },
  });
}

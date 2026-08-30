import { useEffect, useState } from "react";
import { FEATURES } from "./platform";
import { getConsentState, onConsentChange, setConsent } from "./consent";

// The GDPR consent prompt for the web build.
//
// Mounted next to <App/> rather than inside it: App returns early per mode
// (menu, study, quiz, results), so a banner rendered in one branch would vanish
// the moment the user started a deck. As a sibling it is genuinely global.
//
// Shown only where consent is actually required and hasn't been given — see
// src/consent.js for how that is decided. On the Play build FEATURES.ads is
// false and this renders nothing: there, consent is Google UMP's job, collected
// natively by the AdMob SDK.
export default function ConsentBanner() {
  const [consent, setConsentSnapshot] = useState(() => getConsentState());

  useEffect(() => onConsentChange(setConsentSnapshot), []);

  if (!FEATURES.ads || !consent.needsDecision) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie and advertising consent"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: "#0f172a", borderTop: "1px solid #334155",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.45)", padding: "1rem",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ fontSize: "0.82rem", color: "#cbd5e1", lineHeight: 1.5 }}>
          We use cookies to show ads and to measure usage with Google Analytics. Decline and
          you'll still get the full app — just no ads or analytics.{" "}
          <a href="/privacy" style={{ color: "#94a3b8" }}>Privacy Policy</a>
        </div>
        {/* Decline is styled as a real, equally reachable button, not a buried
            link: consent has to be as easy to refuse as to give. */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            onClick={() => setConsent(false)}
            style={{ background: "transparent", border: "1px solid #33415560", color: "#94a3b8", borderRadius: 8, padding: "0.5rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}
          >
            Decline
          </button>
          <button
            onClick={() => setConsent(true)}
            style={{ background: "#22c55e", border: "none", color: "#0f172a", borderRadius: 8, padding: "0.5rem 0.9rem", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

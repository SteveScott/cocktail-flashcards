import { useState, useEffect } from "react";
import { needsConsentChoice, setConsent, onConsentChange } from "./consent";
import { FEATURES } from "./platform";

// Cookie/consent prompt for the web build.
//
// Not rendered in the Play app: ads there come from AdMob, whose consent is
// collected by Google's UMP SDK in a native dialog (src/monetization.js). Two
// prompts for the same thing would be worse than none.
//
// "Reject" is as prominent as "Accept" on purpose — a consent flow that nudges
// toward acceptance is not freely given consent under GDPR.
export default function ConsentBanner() {
  // Read straight from storage on first render rather than setting state in an
  // effect, which would flash the banner in and out for users who already chose.
  const [visible, setVisible] = useState(() => FEATURES.ads && needsConsentChoice());

  useEffect(() => {
    if (!FEATURES.ads) return;
    // Reopened when the user withdraws consent from the menu link.
    return onConsentChange(() => setVisible(needsConsentChoice()));
  }, []);

  if (!visible) return null;

  const choose = (granted) => { setConsent(granted); setVisible(false); };

  const button = (bg, color) => ({
    background: bg, color, border: "none", borderRadius: 8,
    padding: "0.55rem 1.1rem", fontSize: "0.85rem", fontWeight: 700,
    cursor: "pointer", whiteSpace: "nowrap", flex: "1 1 auto",
  });

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie choices"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: "#111c33", borderTop: "1px solid #334155",
        padding: "1rem 1.25rem", boxShadow: "0 -8px 24px #00000055",
      }}
    >
      <div style={{ maxWidth: "44rem", margin: "0 auto" }}>
        <div style={{ color: "#cbd5e1", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "0.85rem" }}>
          We'd like to use cookies for ads and analytics. Studying works either way —
          decline and you'll still see the app, just without personalised ads or usage
          measurement. You can change your mind any time from the Privacy link on the menu.{" "}
          <a href="/privacy" style={{ color: "#60a5fa" }}>Privacy Policy</a>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <button onClick={() => choose(false)} style={button("#334155", "#e2e8f0")}>Reject</button>
          <button onClick={() => choose(true)} style={button("#22c55e", "#0f172a")}>Accept</button>
        </div>
      </div>
    </div>
  );
}

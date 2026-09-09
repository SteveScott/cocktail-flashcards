import { useEffect, useRef, useState } from "react";
import { adSlotId, adsenseClient, isAdNetworkConfigured } from "./ads";

// A display ad that reserves its space up front and gives it back if no ad comes.
//
// The app is a 480px column of tightly packed cards with no gaps to spare, which
// is exactly the layout Auto ads cope worst with: left to place themselves they
// either find nowhere and serve nothing, or wedge a unit between two controls.
// So placement is explicit — App.jsx decides where an ad may go, and this
// component owns what happens in that space.
//
// Three states, and the space differs in each:
//   pending — the request is out. The box is held open at `minHeight` so the ad
//             lands in room already made for it instead of shoving the page down.
//   filled  — an ad is on screen. The box stays, labelled.
//   empty   — nothing is coming. The component unmounts entirely, so the
//             reserved space collapses and the layout closes up as if the ad
//             slot had never been in the tree.
//
// "Empty" is reached three ways: AdSense says `unfilled`, the push throws, or
// nothing answers within RESERVE_MS. That last one is what covers the cases with
// no callback at all — an ad blocker, a blocked script, an account still waiting
// on approval. Without it the page would hold a blank hole open forever.
//
// The collapse is a deliberate layout shift. Reserving space is the whole point
// of the component; giving it back a moment later is the cost of not knowing in
// advance whether an ad exists, and it is bounded by RESERVE_MS.
const RESERVE_MS = 5000;

export default function AdSlot({ placement, minHeight = 250, marginTop = "1.25rem" }) {
  const slot = adSlotId(placement);
  const enabled = isAdNetworkConfigured && Boolean(slot);
  const insRef = useRef(null);
  const pushedRef = useRef(false);
  const [state, setState] = useState("pending");

  useEffect(() => {
    if (!enabled) return;
    const ins = insRef.current;
    if (!ins) return;

    // Pushing an <ins> AdSense has already claimed throws "All ins elements in
    // the DOM with class=adsbygoogle already have ads in them", which kills every
    // other unit on the page too. Two guards because they cover different things:
    // the ref catches StrictMode's double-invoked effect (refs survive it), the
    // dataset catches an element AdSense has processed by any other route.
    if (!pushedRef.current && !ins.dataset.adsbygoogleStatus) {
      pushedRef.current = true;
      try {
        // Safe before the tag loads: the array is a queue the script drains on
        // arrival, which is why nothing here waits for it.
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        console.error("adsbygoogle push failed", e);
        // Collapse on the next tick rather than straight from the effect body:
        // same outcome, without a cascading render mid-effect.
        const failed = setTimeout(() => setState("empty"), 0);
        return () => clearTimeout(failed);
      }
    }

    // AdSense stamps the element once the request resolves. It may already be
    // stamped if this effect is re-running, hence the read before observing.
    const read = () => {
      const status = ins.getAttribute("data-ad-status");
      if (status === "filled") { setState("filled"); return true; }
      if (status === "unfilled") { setState("empty"); return true; }
      return false;
    };
    if (read()) return;

    const observer = new MutationObserver(() => { if (read()) observer.disconnect(); });
    observer.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
    const timer = setTimeout(() => setState(s => (s === "pending" ? "empty" : s)), RESERVE_MS);

    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [enabled, slot]);

  if (!enabled || state === "empty") return null;

  return (
    <div style={{ marginTop, minHeight, display: "flex", flexDirection: "column" }}>
      {/* Rendered in both states rather than only when filled, so arriving ads
          don't nudge the page by a line of text. AdSense requires the wording be
          "Advertisement" or "Sponsored Links" if a label is used at all. */}
      <div
        aria-hidden={state !== "filled"}
        style={{
          fontSize: "0.62rem", letterSpacing: "0.08em", textTransform: "uppercase",
          color: "#64748b", textAlign: "left", marginBottom: "0.3rem",
          opacity: state === "filled" ? 1 : 0,
        }}
      >
        Advertisement
      </div>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: "block", width: "100%" }}
        data-ad-client={adsenseClient}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}

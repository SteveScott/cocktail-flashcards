# Ad & analytics consent (GDPR / ePrivacy)

The two platforms now work differently, and the reason matters.

| | Web | Android app |
|---|---|---|
| Ads | PropellerAds | AdMob |
| Consent UI | our own banner (`src/ConsentBanner.jsx`) | Google UMP native dialog |
| Delivered by | the app bundle | the AdMob SDK |
| Signals | Consent Mode v2, region-scoped | `canRequestAds` from UMP |
| Change/withdraw | "Privacy & cookie settings" on the menu | "Ad privacy options" on the menu |

## Web

### Why this is hand-rolled

The site used to run AdSense, whose tag also delivered Google's Funding Choices
consent message — a certified CMP, for free, with no UI of ours. AdSense rejected
the site on content grounds and is not being re-enabled, so that message went
away with it. PropellerAds ships no consent UI, so the banner is ours now.

**The non-obvious casualty was Google Analytics.** `index.html` defaults
`analytics_storage` to *denied* across the EEA/UK/CH, and the only thing that
ever flipped it to granted was Google's own message. Analytics is staying, so
`src/consent.js` must issue the `gtag('consent','update',…)` call that the
AdSense tag used to — otherwise every European visitor silently disappears from
Analytics forever.

### How it works

`index.html` sets Consent Mode v2 defaults **above the gtag loader**, region
scoped per Google's documented pattern:

- **denied** across the EEA, UK and Switzerland
- **granted** everywhere else (the unscoped fallback)

Region-specific defaults win over the global one. A blanket `denied` would switch
analytics off worldwide, because users outside scope are never shown a banner
that could grant it.

`src/consent.js` holds the decision (localStorage, `cocktail_consent_v1`) and:

- `consentRequired` — is this visitor in scope?
- `needsConsentDecision()` — in scope and hasn't answered → raise the banner
- `adsAllowed()` — out of scope, or an explicit grant. Undecided is treated
  exactly like a refusal
- `setConsent()` — persists, calls `gtag('consent','update',…)`, notifies React
- `initConsent()` — replays a stored grant on startup, so a returning visitor
  isn't stuck on the denied defaults
- `openPrivacySettings()` — clears the decision, re-denies, and lets the banner
  return

**Unlike the AdSense tag it replaced, the ad tag IS gated on consent**
(`src/App.jsx` → `src/ads.js`). AdSense had to load before the user decided
because it carried the consent prompt with it. PropellerAds carries nothing, and
our banner is already on screen, so there is nothing to lose by waiting.

### Region detection is a time-zone guess

There is no IP geolocation in the browser, so `src/consent.js` matches the IANA
time zone against `Europe/*` plus a few Atlantic zones. This **deliberately
over-includes** — Russia, Türkiye and Serbia match too. Showing a banner to
someone who didn't need one is harmless; skipping it for someone who did is not.

It can under-detect (a VPN, or a traveller whose clock says `America/New_York`).
Those visitors are treated as out of scope by the banner, while Google's own
region-scoped defaults still deny their analytics storage by IP. The failure mode
is lost analytics, never an unconsented tag.

### Dashboard setup required

None for consent — that is the point of owning it. PropellerAds still needs its
zone configured (`VITE_PROPELLER_TAG_SRC`, `VITE_PROPELLER_ZONE_ID`) and its
`ads.txt` line published at `public/ads.txt`.

## Android

`gatherAdConsent()` in `src/monetization.js` runs **before `AdMob.initialize()`**
and before any banner:

1. `requestConsentInfo()` — asks UMP whether this user's region requires a choice
2. `showConsentForm()` — only when the status is `REQUIRED` and a form exists, so
   users outside the EEA/UK are never interrupted
3. `canRequestAds` gates `showBanner()`

Consent failures **fail closed** (no ads), rather than defaulting to showing them
in a region that requires consent.

`privacyOptionsRequirementStatus` drives the "Ad privacy options" menu link,
which reopens `showPrivacyOptionsForm()` — required in the EEA/UK so consent can
be withdrawn as easily as it was given.

### Dashboard setup required

AdMob console → Privacy & messaging → **GDPR** → create a message, select the
app, publish. Until then `isConsentFormAvailable` is false and no form appears.

Test with `debugGeography: AdmobConsentDebugGeography.EEA` in
`requestConsentInfo()` plus your device's test id, or you'll never see the form
from outside Europe. `AdMob.resetConsentInfo()` re-prompts while testing.

## Testing the web banner from outside the EEA

The banner keys off the browser time zone, so no VPN is needed: set your machine
(or the browser profile) to a European time zone and reload. Clear the
`cocktail_consent_v1` localStorage key to get an undecided state back, or just
use "Privacy & cookie settings" in the footer, which does the same thing.

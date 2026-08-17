# Ad & analytics consent (GDPR / ePrivacy)

Both platforms use a **Google-certified CMP**, which is what serving ads to
EEA/UK users requires — a hand-rolled banner does not qualify, however correct
its behaviour.

| | Web | Android app |
|---|---|---|
| Ads | AdSense | AdMob |
| Consent UI | Google's GDPR message (AdSense → Privacy & messaging) | Google UMP native dialog |
| Delivered by | the AdSense tag itself | the AdMob SDK |
| Signals | Consent Mode v2, region-scoped | `canRequestAds` from UMP |
| Change/withdraw | "Privacy & cookie settings" on the menu → `googlefc.showRevocationMessage()` | "Ad privacy options" on the menu → `showPrivacyOptionsForm()` |

## Web

`index.html` sets Consent Mode v2 defaults **above the gtag loader**, region
scoped per Google's documented pattern:

- **denied** across the EEA, UK and Switzerland
- **granted** everywhere else (the unscoped fallback)

Region-specific defaults win over the global one. A blanket `denied` would switch
analytics off worldwide, because users outside scope are never shown a message
that could grant it.

**The AdSense script is intentionally not gated on consent** (`src/App.jsx`).
Google's GDPR message is delivered by that same tag, so blocking it would block
the consent prompt itself. Ads are withheld until the user decides by Google's
CMP, and Consent Mode keeps storage denied in the meantime.

`src/consent.js` is only glue:

- `openPrivacySettings()` → `googlefc.showRevocationMessage()`, which clears the
  stored record and re-shows the message
- `onGdprApplicable()` → via `googlefc.callbackQueue` / `__tcfapi`, so the
  settings link appears only for visitors GDPR actually covers

### Dashboard setup required

AdSense console → **Privacy & messaging** → **GDPR** → create a message, select
the site, **publish**. Until then no message exists, `googlefc` never loads, and
the settings link stays hidden. Publish the **US states** message too if you want
CCPA/CPRA handling.

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

## Testing the web message from outside the EEA

Google's message only renders for in-scope users. Use a VPN with an EEA exit, or
the AdSense message editor's preview. There is no debug-geography equivalent to
the AdMob one.

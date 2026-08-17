# Ad & analytics consent (GDPR / ePrivacy)

Two separate mechanisms, because the two platforms serve ads from different
systems and only one of them can use Google's own consent SDK.

| | Web | Android app |
|---|---|---|
| Ads | AdSense | AdMob |
| Consent UI | `src/ConsentBanner.jsx` | Google UMP native dialog |
| State | `src/consent.js` (localStorage `consent_v1`) | UMP SDK, on-device |
| Signals | Consent Mode v2 via `gtag` | `canRequestAds` from UMP |
| Withdraw | "Cookie choices" on the menu | "Ad privacy options" on the menu |

## Web

`index.html` sets **all four Consent Mode v2 signals to `denied` before the gtag
loader runs**, then re-applies a stored `granted` choice inline so returning
users aren't measured as denied for the first half second. Order matters: move
that block below the loader and the first pageview is already sent with storage
enabled.

The AdSense script is not merely de-personalised without consent — it is not
loaded at all (`src/App.jsx`), since ePrivacy requires that nothing non-essential
runs before agreement.

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

UMP renders **a message you configure**, so until that exists no form appears and
`isConsentFormAvailable` is false:

AdMob console → Privacy & messaging → **GDPR** → create a message, select the app,
publish. Do the same for the **US states** message if you want CCPA/CPRA handling.

Test with `debugGeography: AdmobConsentDebugGeography.EEA` in
`requestConsentInfo()` plus your device's test id, or you'll never see the form
from outside Europe. Use `AdMob.resetConsentInfo()` to re-prompt while testing.

## Known gap: certified CMP on the web

Google requires a **certified CMP integrated with IAB TCF** to serve ads to
EEA/UK users. UMP satisfies this on Android. The web banner here satisfies
ePrivacy (nothing loads before consent) and signals Consent Mode correctly, but
it is **not** TCF-certified, so EEA/UK web ad serving may be limited until one of:

- AdSense console → Privacy & messaging → publish Google's own GDPR message
  (free, certified). If you enable it, the AdSense script must be allowed to load
  so the message can render — revisit the gating in `src/App.jsx` at that point.
- A third-party certified CMP (Cookiebot, Didomi, …).

Analytics-only consent is unaffected either way.

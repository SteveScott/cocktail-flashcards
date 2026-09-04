# Ad & analytics consent (GDPR / ePrivacy)

The two platforms work differently, and the reason matters.

| | Web | Android app |
|---|---|---|
| Ads | Google AdSense | AdMob |
| Consent UI | Google Funding Choices (`window.googlefc`) | Google UMP native dialog |
| Delivered by | the AdSense tag | the AdMob SDK |
| Signals | Consent Mode v2, region-scoped + IAB TCF | `canRequestAds` from UMP |
| Change/withdraw | "Privacy & cookie settings" on the menu | "Ad privacy options" on the menu |

## Web

### Why the CMP is Google's, not ours

Serving AdSense in the EEA/UK requires a Google-certified, IAB TCF CMP. Funding
Choices is one, it is free, and it arrives on the AdSense tag itself — no UI of
ours to build, certify or keep certified. A hand-rolled banner cannot satisfy
that requirement no matter how carefully it is written.

There was a self-hosted banner here for a while. It existed only because the site
ran **PropellerAds** in between, which ships no consent UI at all — and it went
when PropellerAds did (their inventory does not permit alcohol and beverage
advertising, which is the whole subject of this site). With AdSense back, keeping
that banner would have been actively wrong: an uncertified prompt gating EEA
AdSense traffic, and two consent prompts competing for the same answer.

**This is also what keeps Google Analytics alive in Europe.** `index.html`
defaults `analytics_storage` to *denied* across the EEA/UK/CH, and Google's
message is the only thing that ever flips it to granted there. During the
PropellerAds period `src/consent.js` had to issue that `gtag('consent','update',…)`
call itself; with the CMP back it rides in on the tag again.

### How it works

`index.html` sets Consent Mode v2 defaults **above the gtag loader**, region
scoped per Google's documented pattern:

- **denied** across the EEA, UK and Switzerland
- **granted** everywhere else (the unscoped fallback)

Region-specific defaults win over the global one. A blanket `denied` would switch
analytics off worldwide, because users outside scope are never shown a message
that could grant it.

Google's message, configured in **AdSense → Privacy & messaging**, resolves those
defaults once an in-scope user chooses. `src/consent.js` is only the glue for
revisiting that choice:

- `openPrivacySettings()` — `googlefc.showRevocationMessage()`, so consent can be
  withdrawn as easily as it was given, which the GDPR requires
- `onGdprApplicable(cb)` — the TCF `gdprApplies` flag, so the "Privacy & cookie
  settings" link is shown only to visitors it means anything for

### The ad tag is deliberately NOT gated on consent

`src/App.jsx` loads `src/ads.js` as soon as it knows the user isn't ad-free —
before any consent decision. That is not an oversight. The consent prompt is
delivered *by the AdSense tag*, so gating the tag on consent would block the
prompt that produces the consent, and neither would ever happen.

What protects the user in the meantime is Google's own machinery: the CMP
withholds ads until the choice is made, and the region-scoped Consent Mode
defaults keep storage denied across the EEA/UK/CH regardless.

The one gate that does apply is ad removal — a paid-up user never fetches the
script at all. There is no mid-session teardown, and `src/ads.js` explains why:
removing the tag would take Funding Choices with it, and web ad removal goes
through Stripe Checkout, which returns on a fresh page load anyway.

### Dashboard setup required

**AdSense console → Privacy & messaging → GDPR** — create a message, select the
site, publish. Until then `googlefc.showRevocationMessage` is missing, the
settings link logs an error and does nothing, and no consent message appears for
European visitors.

The site also needs to be **approved by AdSense** before any of this serves. It
has been rejected before on content grounds. `public/ads.txt` carries the
publisher line, and `VITE_ADSENSE_CLIENT` can be set to an empty string to switch
web ads off entirely while a review is pending (see `.env.example`).

**Ads → By ad unit → Display ads** — create one unit per placement and set
`VITE_ADSENSE_SLOT_MENU` / `VITE_ADSENSE_SLOT_INDEX` to their ids. Ads are placed
by hand, not by Auto ads (see below), so without these ids nothing renders no
matter what else is configured.

## Where web ads go, and what happens when they don't come

`src/AdSlot.jsx` owns this. The app is a 480px column of tightly packed cards,
which is the layout Auto ads handle worst: left to place themselves they either
find nowhere and serve nothing, or wedge a unit between two controls. So the
placements are explicit — currently the **menu** screen (below every control,
above the legal footer) and the **index** screen (below the results list, outside
its 60vh scroll box).

Study and quiz screens are deliberately **not** placements. Both are rapid
tap-tap-tap surfaces, which is the accidental-click pattern AdSense prohibits,
and an ad mid-deck interrupts the one thing the app is for.

Each slot reserves `minHeight` up front so an arriving ad lands in space already
made for it, then **collapses to nothing** — unmounting, so margins go too — if
the ad never comes. That happens three ways: AdSense reports `unfilled`, the push
throws, or nothing answers within 5s. The last one is what covers an ad blocker,
a blocked script, or an account still pending approval, none of which call back
at all. Reserving and then giving the space back is a deliberate layout shift:
the alternative is either a permanent blank hole or an ad that shoves the page
down when it lands.

The "Remove Ads" card keys off the same evidence — `areAdsServing()` in
`src/ads.js` watches for a `data-ad-status="filled"` unit anywhere on the page —
so a visitor who is served no ad is never offered the chance to remove one.

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

## Testing the web consent message from outside the EEA

Google decides scope by IP, so unlike the old time-zone banner this genuinely
needs a European IP — a VPN, or the AdSense message preview. Once a choice has
been made, "Privacy & cookie settings" in the footer reopens it via
`showRevocationMessage()`, which is the quickest way back to an undecided state.

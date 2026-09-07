# Cocktail Flashcards

Spaced-repetition flashcards and quizzes for 321 classic cocktail recipes, built
for bartenders. It runs as a website, as an installable PWA, and as the Android
app on Google Play — which loads the same live site inside a Capacitor shell.
Progress syncs across devices through a Google account; ads can be removed by a
one-time purchase on either platform.

This document is the architecture. It covers how the pieces fit together, where
every kind of data lives, how facts about a recipe are derived from its text,
and how the app copes with the cocktails that refuse to follow the rules.

## Contents

- [The shape of the system](#the-shape-of-the-system)
- [Repository map](#repository-map)
- [The recipe data](#the-recipe-data)
- [The rule process: deriving facts from a recipe](#the-rule-process-deriving-facts-from-a-recipe)
- [Irregular cocktails: overrides and exceptions](#irregular-cocktails-overrides-and-exceptions)
- [The app](#the-app)
- [Storage and sync](#storage-and-sync)
- [Platforms: web, PWA, Play Store](#platforms-web-pwa-play-store)
- [Monetization, entitlements and consent](#monetization-entitlements-and-consent)
- [Backend: Netlify functions](#backend-netlify-functions)
- [Build, SEO and deploy](#build-seo-and-deploy)
- [Security model](#security-model)
- [Configuration](#configuration)
- [Development](#development)
- [Further reading](#further-reading)

## The shape of the system

```
                 src/cocktails.json  ──────────────────┐
                        │                              │
                        ▼                              ▼
              src/recipe-meta.js  ◄──────────  scripts/seo-pages.mjs
              (method, order, steps)            (321 static HTML pages,
                        │                        JSON-LD, sitemap — at build)
                        ▼
                  src/App.jsx  ─── one component, one `mode` state machine
                   │        │
        localStorage        Firestore users/{uid}  ◄── Netlify functions
        (always)            (signed in; live sync)      (Stripe / RevenueCat
                                                          webhooks, account
                                                          deletion — Admin SDK)
   ┌────────────────────────────────────────────────────────────────────┐
   │  Web (Netlify)   ·   PWA (network-first SW)   ·   Play (Capacitor  │
   │  shell loading https://cocktailflashcards.com/?platform=play)      │
   └────────────────────────────────────────────────────────────────────┘
```

Five ideas explain most of the design:

1. **There is one deployed site.** The Play Store app does not ship a bundle;
   its Capacitor shell loads the live site. Web deploys and Play releases are
   therefore on independent schedules, and the JavaScript that reaches a phone
   is whatever Netlify built last. Platform differences are handled at
   *runtime* (see `src/platform.js`), never at build time.
2. **The data is the recipe text.** Each cocktail is a name, a glass and one
   comma-separated ingredient string. Everything else a card or a page shows —
   the method, the build order, the step-by-step instructions — is derived from
   that string by `src/recipe-meta.js`, or stored as an explicit override when a
   rule would get it wrong.
3. **One derivation module, two consumers.** `recipe-meta.js` is free of React,
   DOM and Node APIs so the same code runs in the browser bundle and in the
   build-time static page generator. A recipe page and a flashcard can never
   disagree about a drink, because they never compute it twice.
4. **Firestore rules are the security boundary, the client is not.** The
   monetization code ships in the bundle deliberately; what stops a user
   granting themselves ad removal is that clients cannot write the field.
5. **Progress is merged, never replaced.** Local and cloud state are reconciled
   by an idempotent union, so nothing a device did offline is lost when it
   reconnects, and two devices editing at once converge.

## Repository map

| Path | What it is |
|---|---|
| `src/cocktails.json` | The recipe database. Two lists, 321 recipes, one per line. |
| `src/recipe-meta.js` | Derivations over the recipes: parsing, method inference, build order, step generation. Shared with the build. |
| `src/App.jsx` | The entire UI: menu, study, quiz, index, sign-in, admin panel, purchase flows. One component. |
| `src/platform.js` | Runtime detection of web vs Play Store shell; the `FEATURES` switches. |
| `src/firebase.js` | Firebase init from `VITE_FIREBASE_*`; ad-whitelist helpers. |
| `src/native-auth.js` | Google sign-in through Android's account picker for the Capacitor build. |
| `src/ads.js`, `src/AdSlot.jsx` | Web display ads (AdSense): tag loading, "is an ad actually on screen", space reservation. |
| `src/monetization.js` | Play build: AdMob banner, UMP consent, RevenueCat / Play Billing. |
| `src/consent.js` | Reopening Google's GDPR message; whether GDPR applies to this visitor. |
| `src/main.jsx` | Mounts the app; registers the PWA service worker. |
| `src/index.css`, `src/App.css` | Global styles and self-hosted fonts. Component styling is inline. |
| `scripts/seo-pages.mjs` | Vite plugin that emits a static HTML page per recipe, an index, and a sitemap. |
| `scripts/create-remove-ads-product.mjs` | One-time Stripe product/price setup. |
| `netlify/functions/` | Server side: Stripe checkout + webhook, RevenueCat webhook, account deletion, shared entitlement logic. |
| `firestore.rules` | The access-control model. Read this before touching the `users` document. |
| `public/` | Static assets, `manifest.json`, `pwa-sw.js`, `privacy.html`, `robots.txt`, `ads.txt`. |
| `android/` | The Capacitor Android project. Nothing in it is served; it is the store shell. |
| `docs/` | Deep dives on specific subsystems — listed at the end. |
| `ignore/` | Local scratch, gitignored. Keys and artwork sources live here and never in git. |

## The recipe data

`src/cocktails.json` holds two arrays:

- **`top50`** — the 50 ranked drinks (`rank` 1–50, Drinks International 2026).
  This is the default study pool.
- **`master150`** — the rest. The name is historical; it holds 271 recipes.

Together they are 321 recipes. In `App.jsx` the combined list is called
`ALL_200` for the same historical reason. Neither number in either name is
true any more; the names are not worth a migration.

A recipe is one JSON object on one line, and that formatting is load-bearing:
several maintenance scripts edit the file line by line, and one-line-per-recipe
keeps diffs readable. Keep it that way.

| Field | On | Meaning |
|---|---|---|
| `name` | all | Unique. Used as the key everywhere — scores, decks, learned lists, tried marks. |
| `glass` | all | The vessel, as a short label: `Coupe`, `Rocks`, `Highball (Collins)`, `Coupe or Nick & Nora`. |
| `ingredients` | all | One comma-separated string. See conventions below. |
| `serve` | all | How it reaches the drinker: `up`, `neat`, `on the rocks`, `over crushed ice`, `hot`, `frozen`. |
| `rank` | top50 | Position in the DI list. |
| `method` | 36 | Explicit preparation method, when inference would be wrong. See [overrides](#irregular-cocktails-overrides-and-exceptions). |
| `order` | 7 | `"as-written"` — this recipe's ingredient sequence is sourced or structural and must not be reordered. |

### Ingredient string conventions

The parser reads the string as the data writes it, so the conventions matter:

- **Measures lead:** `2 oz Gin`, `¾ oz Fresh Lime Juice`, `1 tsp Grenadine`,
  `2 dashes Angostura Bitters`, `6 drops Absinthe`. Vulgar fractions
  (`½ ¼ ¾ ⅓ ⅔ ⅛`), never decimals.
- **Small units may drop "of":** `Dash Cognac`, `Splash Cola`, `Pinch Salt`.
- **Some units come after the ingredient:** `Dark Rum float`, `Soda splash`,
  `Absinthe rinse`. A float, a drizzle, a splash and a rinse are amounts of
  liquid, no different from an ounce.
- **Placement markers in parentheses:** `(float)`, `(drizzle)`, `(top)`,
  `(garnish)`, `(layered)`, `(shot)`, `(chaser)`, `(dropped)`, `(on the side)`.
- **Parentheticals may contain commas** — `Don's Mix (2 parts grapefruit
  juice, 1 part cinnamon syrup)` — and the splitter respects them.
- **Unmeasured items are garnish**, unless a marker says otherwise.
- **Order is meaningful.** Ingredients are stored in build order (see below).

## The rule process: deriving facts from a recipe

`src/recipe-meta.js` turns an ingredient string into everything else. Its
functions run in a pipeline; each is a pure function of the recipe object.

```
ingredients string
   │
   ├─ parseIngredients()  ──►  components [{measure, item, text, role}] + garnishes
   │                             role ∈ float | rinse | null
   ├─ getMethod()         ──►  Shaken | Stirred | Built | Blended | Layered | (override)
   ├─ inBuildOrder()      ──►  components sorted liquor → citrus → syrup → juice → last
   ├─ buildSteps()        ──►  numbered instructions, using method + serve + roles
   ├─ summarize()         ──►  one-line description (meta description / lede)
   └─ baseSpirit()        ──►  category for grouping and cross-links
```

### Parsing

`parseIngredients` splits on commas outside parentheses, then classifies each
part:

1. A **leading measure** (`MEASURE_RE`) makes it a component: a quantity, an
   optional unit (`oz`, `dash(es)`, `drop(s)`, `tsp`, `tbsp`, `cup(s)`,
   `scoop(s)`, `shot(s)`, `barspoon`), or a bare small unit with an optional
   "of" (`pinch`, `splash`, `dash`, `shot`, `handful`).
2. A trailing **`(top)`** makes it a component with measure `Top`.
3. A **trailing unit** — `float`, `drizzle`, `splash`, `rinse`, bare or in
   parentheses — makes it a component with that unit as its measure.
4. Anything else is a garnish, as is anything explicitly marked `(garnish)`.

Every component then gets a **role**: `float` (for float or drizzle), `rinse`,
or none. The role says *where the ingredient goes in the sequence* — a float
lands on the finished drink, a rinse coats the glass before anything is poured
— without which nine floats in the deck were being shaken into the drink they
are supposed to sit on top of. The placement table is in
[docs/methods.md → Units written after the ingredient](docs/methods.md#units-written-after-the-ingredient).

### Method inference

`getMethod` applies these in order; the first match wins.

| # | Rule | Result |
|---|---|---|
| 0 | The recipe carries an explicit `method` | that method |
| 1 | Name contains *blend* or *frozen*, **or** ingredients say `blended with` / `(blended)` | `Blended` |
| 2 | Ingredients contain `layered` | `Layered` |
| 3 | Glass is a tall build (`highball`, `collins`, `copper mug`, `pint`, `wine`, `sling`, `zombie`) **and** ingredients contain a mixer (`soda`, `tonic`, `ginger beer/ale`, `cola`, `tomato juice`, `clamato`, `beer`, `champagne`, `prosecco`, `lemonade`…) | `Built` |
| 4 | Ingredients contain something that must be shaken: citrus juice, egg, cream, purée, espresso | `Shaken` |
| 5 | Ingredients mention crushed ice, or `serve` is `over crushed ice` | `Built` |
| 6 | Otherwise — spirit and sugar | `Stirred` |

Two details are deliberate. Rule 1 matches the *technique as written*, not the
bare word "blend", because *Blended Scotch* and *Blended Whiskey* are spirits
and were being sent to a blender. Rule 3 sits above rule 4 so a Mojito is built
rather than shaken, and rule 5 sits below it so a Bramble — shaken, *then*
poured over crushed ice — is still shaken.

The rule of thumb is right for most of the repertoire and wrong for a knowable
set of drinks; that set is handled by overrides, below.

### Build order

Where a recipe does not dictate its own sequence, ingredients go:

**liquor → citrus → syrup → juice → dashes, floats and splashes**

"Liquor" is everything alcoholic, liqueurs included — a Last Word groups its
Chartreuse and maraschino with the gin, ahead of the lime. Carbonated mixers
rank last whatever their volume; a Moscow Mule's four ounces of ginger beer is
still what goes in on top. The sort is stable, so anything the ranking cannot
separate keeps the order the recipe wrote it in.

The same ranking is applied in two places on purpose. `canonicalIngredientOrder`
rewrites the stored ingredient string, and `buildSteps` sorts components before
listing them. Because both use `buildRank`, storing the data in canonical order
changed no generated step — that equivalence is the test that the two agree.
The recipes that opt out, and why, are in
[docs/methods.md → Ingredient order](docs/methods.md#ingredient-order).

### Steps and serving

`buildSteps` has a branch per method. `Built` is the wide one: a soda highball,
a muddled Old Fashioned and a hot toddy are all assembled in the serving vessel
but do not start the same way, so it reads `serve` to decide whether the glass
is preheated (`hot`), packed with crushed ice, filled with cubes, or left alone
(`up`, `neat`); reads the ingredients to decide whether sugar and bitters are
muddled first; and reads a `CARBONATED` list — narrower than the build-mixer
list — to decide whether stirring costs you bubbles.

Around every branch, roles place the exceptions: rinses first; toppers held back
until after straining for drinks mixed elsewhere; floats and drizzles last. A
layered drink with a float is a base with something set on top (a Baby Guinness
pours its coffee liqueur and floats the cream); only a drink whose every
component is a layer, like a B-52, is poured over the back of a spoon.

`serve` also distinguishes **up** from **neat**, which is a temperature
distinction and not a technique one: up is chilled against ice and served off
it; neat is never chilled at all. A Sazerac is `up` in a rocks glass — chilled,
ice discarded, nothing in the glass. `hot` and `frozen` exist because an Irish
Coffee and a Frozen Margarita are none of the other four.

Where the rules are known to still be wrong is recorded in
[docs/methods.md → Known gaps](docs/methods.md#known-gaps).

## Irregular cocktails: overrides and exceptions

A method is a fact about a recipe, not a function of its ingredients. Nothing
in "bourbon, sugar, bitters" says an Old Fashioned is built in the glass —
the IBA says so. So the rules above are a default, and the recipes that break
them carry explicit fields. The governing principle:

> **An override needs a source.** The rule of thumb is a guess, and replacing it
> with a different guess is no improvement.

Every override is recorded in [docs/methods.md](docs/methods.md) with the text
it came from — the IBA specification where one exists, otherwise the originating
bartender or the standard reference. Add a row there when you add an override.

### `method` — 36 recipes

Twenty-four are drinks built in the serving vessel — the Old Fashioned family,
Champagne Cocktail, Irish Coffee, Black Russian, Rusty Nail, Kir, Treacle, Ti'
Punch, the hot drinks — which read as spirit-and-sugar and would otherwise be
called Stirred (all but the Hot Toddy, which the shake rule sent to a shaker
instead). Others correct a wrong shake or stir: Brandy Milk Punch and Toasted
Almond are shaken (dairy the shake rule misses); Black Velvet, Snakebite, Baby
Guinness and True Blood are layered.

Five needed techniques inference has no rule for at all, each with its own
`buildSteps` branch:

| Method | Drink | What it means |
|---|---|---|
| `Flash Blend` | Zombie | Whipped with crushed ice for no more than five seconds — a technique, not a frozen drink. |
| `Thrown` | Blue Blazer | Ignited and poured in a blazing stream between two mugs (Jerry Thomas, 1862). |
| `Heated` | Mulled Wine | Warmed in a saucepan; not a cocktail technique. |
| `Dropped` | Jägerbomb | A bomb shot: the shot glass goes into the mixer. |
| `Chased` | Pickleback | Nothing is mixed. Spirit, then chaser. |

Equally important is the list of drinks that were **checked and deliberately
left alone** — Sazerac, Stinger, Seelbach, Harvard — because inference already
matched the published method. They are recorded so nobody re-litigates them.

### `order: "as-written"` — 7 recipes

The build-order default is for "where not specified". These recipes specify:

- **Aperol Spritz** — the IBA builds prosecco, then Aperol, then soda: the 3-2-1.
- **Caipirinha, Caipiroska** — lime and sugar are muddled together first.
- **Michelada, Chelada** — built on the beer, which the default would send to the end as a topper.
- **Trinidad Sour** — Angostura is the base spirit, not a dash.
- **Blue Blazer** — scotch and boiling water go into the mug before the sugar.

Layered drinks are never reordered; the sequence is the recipe. The tiki drinks
were checked and *not* pinned: Difford's orders Three Dots and a Dash, Test
Pilot and Nui Nui in the default order, so the deck's old sequence was
inconsistent data rather than preserved sourcing.

### `serve` — set by hand where no rule reaches

`serve` was derived once from glass and method for all 321 recipes, then
corrected by hand where the derivation cannot know: the Sazerac (`up` despite a
rocks glass); Kir, Snakebite, Boilermaker, Eggnog and Jägerbomb (cold but never
poured over ice); Ti' Punch and Whisky Mac (`neat` — room temperature by
tradition, and in Martinique comfortably above 80°F).

### House recipes

Some drinks have no external source at all. The **True Blood** is a house
cocktail from QXT's; searching the name returns an unrelated drink built on
peach schnapps and orange juice. The recipe's owner is the authority on it, and
it must never be "corrected" against the internet. Recipes like this should say
so in `docs/methods.md`, because without a note someone eventually will.

## The app

`src/App.jsx` is a single component. The screen is a string, `mode`, with six
values:

| `mode` | Screen |
|---|---|
| `menu` | Stats, sign-in, mode buttons, ad-removal and admin panels. |
| `index` | Search across all 321 (accent-insensitive: "pina" finds Piña Colada), add/remove from the study deck, mark tried, filter by tried. |
| `study` | The flashcard deck. Reveal, grade, prev/next, shuffle, deck-size picker. |
| `quizlen` | Choose a quiz length. |
| `quiz` | Self-graded reveal quiz over a fresh shuffle of the whole pool. |
| `results` | Score, missed list, fireworks at 100%. |

### Study

- The **pool** is `top50`, or all 321 in *master mode* (`masterMode`).
- The **deck** (`active`) is a list of names of size `deckSize` (default 20),
  filled from the pool in order. `refillDeck` brings it to size after any
  change — padding from the pool, or truncating past the limit.
- Each name has a **score**. Got it: +1. Missed it: −1, floored at 0. At
  `MASTERY_SCORE` (6) the card moves to `learned`, leaves the deck, and the deck
  refills. Card colours follow the score: grey, blue at 2, amber at 4, green at 6.
- Adding a drink from the index puts it at the **front** of the deck, so the size
  cap trims the deck's last card rather than the one just added, and pulls it
  out of `learned` so it reappears.
- Switching master mode filters `learned` and `active` to names valid in the new
  pool; scores are kept.

### Quiz

Every quiz is a fresh Fisher–Yates shuffle of the **whole pool**, not the deck,
sliced to the chosen length — shuffle before slice is what makes a short quiz a
random sample. Grading is self-reported and does not touch study scores.

### Tried

A drink can be marked tried from the card or from the index. This is a fact
about the drinker, independent of study: it touches neither deck nor scores,
and a drink can be tried without ever having been studied. The index filter
(All / Tried / Not tried) is component state, not persisted — a way of looking
at the list, not progress.

## Storage and sync

### The progress object

Everything that is *progress* lives in one object, `st`:

```js
{
  scores:     { [name]: number },   // per-drink study score
  active:     [name],               // the study deck, in order
  learned:    [name],               // mastered
  tried:      [name],               // marked tried
  masterMode: boolean,              // pool = all 321 (true) or top50
  deckSize:   number,               // default 20
  uid?:       string                // stamped when it belongs to an account
}
```

Names, not indices. An earlier format stored indices, and `loadLocal` refuses
any saved state whose deck is numeric, which is what the `v4` in the storage
key is about.

### Local

`localStorage["cocktail_state_v4"]` is written on every change to `st`, in an
effect, unconditionally. It is the only store for anonymous use and the offline
copy for signed-in use. Private-mode failures are swallowed.

### Cloud

Signed in, progress lives in Firestore at `users/{uid}`:

```
users/{uid}
  progress:          <the object above>     ← client writes
  updatedAt:         number                 ← client writes
  adsRemoved:        boolean                ← server only: stripe || play
  adsRemovedStripe:  boolean                ← server only (Stripe webhook)
  adsRemovedPlay:    boolean                ← server only (RevenueCat webhook)
  stripeSessionId, …                        ← server only
```

`firestore.rules` lets a client create or update its own document **only if the
write touches nothing but `progress` and `updatedAt`** (`hasOnly`, not a
denylist — a server-owned field added later is protected by default). Listing
the collection and deleting a document are denied outright.

**Autosave** pushes `st` 800 ms after it last changed, with `merge: true` so it
never clobbers the server-owned fields.

**Live sync** is an `onSnapshot` subscription on the user's document, opened on
sign-in and kept open. Subscribing rather than reading once is what makes web
and phone converge: a card mastered in the Play app and a purchase made on either
platform land on the same document, and every other open device picks them up.
Three rules keep it stable:

1. Snapshots with `hasPendingWrites` are ignored — our own un-acked writes echo
   back locally first, and a half-applied local state must not round-trip as if
   it were remote.
2. The **first snapshot is the sign-in handshake.** It decides what to do with
   whatever was on the device: if it already belonged to *this* account
   (`uid` stamp) or is anonymous progress the person actually built up, it is
   **merged** into the account; otherwise — a different account was loaded, or
   it is just the starter deck — the account's own progress is loaded instead,
   so one account never bleeds into another.
3. **Later snapshots are merged, never applied.** `mergeStates` is idempotent
   and `progressEqual` compares by value, so a remote update that changes
   nothing keeps the previous object and does not re-trigger autosave. Without
   that comparison the merge would produce a fresh object, autosave would write
   it, and the write would echo back forever.

`mergeStates(a, b)` takes the **max** of each score, the **union** of `learned`,
the **union** of `tried`, the union of `active` minus anything learned, `OR` of
master mode, and the first defined deck size — then refills the deck. The unions
are deliberate: a device cannot un-know that a drink was mastered or drunk.

Sign-out clears local progress only if it was stamped with an account; an
anonymous device's progress survives the app's initial "no user" callback.

### Adding a field to progress — the three traps

Each of these fails silently, and none shows up in a build or a lint:

1. **`mergeStates` rebuilds the state from an object literal**, not a spread.
   A field it does not name is dropped on every cloud merge.
2. **`progressEqual` gates the sync loop.** A field it does not compare makes a
   remote change to it read as "no change", and the change is discarded.
3. **`hasLocalProgress` on sign-in** decides whether local state is worth
   keeping. A field it does not check can be thrown away by the act of signing in.

`refillDeck` and the mode toggle spread `st`, so they carry new fields already.

### Other stored things

- **Ad whitelist** — Firestore `adWhitelist/{email}`, document id the lowercased
  email. A signed-in user may read only their own entry; only the `admins()`
  list in `firestore.rules` may list or write. Users on it never see ads.
- **Account deletion** goes through a Netlify function with the Admin SDK,
  because the rules forbid a buyer erasing their own purchase record and the
  client SDK refuses to delete a session more than a few minutes old. Firestore
  documents are deleted *before* the auth user, so a failure cannot orphan data
  under a uid that can never sign in again. Local progress is cleared too.
- **Not stored anywhere:** the index's tried filter, quiz state, the current
  screen, the card index. All of it is component state.

## Platforms: web, PWA, Play Store

### One site, detected at runtime

`capacitor.config.json` points the Android shell's `server.url` at
`https://cocktailflashcards.com/?platform=play`. `src/platform.js` exposes two
flags and a feature table:

- `isPlayApp` — `window.Capacitor` exists, **or** the URL carries
  `?platform=play`. Used to *hide* what Play policy forbids (web AdSense in an
  app WebView; Stripe for digital goods). Better to suppress a moment early than
  breach policy, so the URL flag alone is enough.
- `isCapacitorApp` — the plugin bridge is actually present and reports a native
  platform. Used for anything that *calls* a plugin, which would fail without it.
- `FEATURES = { ads, stripePurchase, nativeAds, nativePurchase }` — the first two
  are `!isPlayApp`, the last two `isCapacitorApp`.

This hides features; it is not a security boundary (see [Security model](#security-model)).

### PWA

`public/manifest.json` makes the site installable. `public/pwa-sw.js` is a
**network-first** service worker: it prefers the network on every request and
falls back to a small cached shell only when offline, so a web deploy reaches
installed and wrapped clients immediately with no stale precached bundle to
fight. It lives at `/pwa-sw.js` rather than `/sw.js` for reasons recorded in
`src/main.jsx`, which also unregisters any surviving old-path worker.
See [docs/pwa.md](docs/pwa.md).

### Native sign-in

The Firebase JS SDK's popup and redirect flows cannot complete inside an Android
WebView. On the Play build, `src/native-auth.js` hands sign-in to Android's own
account picker via `@capacitor-firebase/authentication` (with `skipNativeAuth`,
so the plugin picks the account and nothing else), then exchanges the Google ID
token for a Firebase session with `signInWithCredential`. Downstream — auth
state, the Firestore subscription, the whitelist check — is identical on both
platforms. See [docs/mobile-google-signin.md](docs/mobile-google-signin.md).

## Monetization, entitlements and consent

A user is **ad-free** if any of three things is true:

```
adFree = adWhitelisted || adsRemovedCloud || adsRemovedNative
```

— on the whitelist, `adsRemoved` on their Firestore document, or (Play build)
RevenueCat reports the entitlement on this device.

### Web

- **AdSense**, loaded by `src/ads.js` only once the whitelist check has settled
  and the user is not ad-free, and never in the Play shell. The tag is
  deliberately **not gated on consent**: it also delivers Google's IAB-certified
  GDPR message, so a consent gate would block the prompt itself. Consent Mode
  defaults in `index.html` keep storage denied across the EEA/UK/CH until the
  message resolves. `src/consent.js` lets users reopen it.
- Ads are placed explicitly by `AdSlot` (menu and index), which reserves space,
  keeps it if an ad fills, and unmounts if nothing arrives within 5 s — an ad
  blocker, a blocked script, or an account still pending review.
- The **"Remove Ads" card appears only once an ad is demonstrably on screen**
  (`areAdsServing` watches for `data-ad-status="filled"` for 30 s). Offering to
  remove ads that are not there reads as a broken button.
- Purchase is **Stripe Checkout** ($4.99, one-time). The function verifies the
  buyer's Firebase ID token and sets `client_reference_id = uid`; Stripe's
  webhook grants `adsRemovedStripe`. The app returns to `/?purchase=success` and
  polls the document six times at 1.5 s, since the webhook lags the redirect.

### Play

- **AdMob** banner, shown while not ad-free, hidden once ad-free. Consent is
  collected through Google's UMP SDK before any ad request.
- Purchase is **Google Play Billing via RevenueCat** (`src/monetization.js`).
  The app calls `Purchases.logIn(uid)` so the RevenueCat app-user id *is* the
  Firebase uid; RevenueCat's webhook then grants `adsRemovedPlay`, which is how a
  phone purchase becomes ad-free on the web. Purchases made before sign-in carry
  an anonymous id and are skipped until RevenueCat aliases them onto the uid.
- A `test_` RevenueCat key is refused in a production build outright.
  See [docs/mobile-monetization.md](docs/mobile-monetization.md).

### Two payment systems, one flag

Stripe and Play are separate purchases and neither speaks for the other. Each
webhook writes only **its own** flag inside a transaction, and `adsRemoved` — the
one field clients read — is recomputed as their union on every write. Letting
both write `adsRemoved` directly meant a Play refund wrote `false` straight over
a valid Stripe purchase. Documents from before the split, which carry only
`adsRemoved: true`, are attributed to Stripe, the only thing that ever set it.
See `netlify/functions/_entitlements.mjs`.

## Backend: Netlify functions

| Function | Trigger | Does |
|---|---|---|
| `create-checkout-session` | App, `POST` with a Firebase ID token | Verifies the token, creates a Stripe Checkout session keyed to the uid. |
| `stripe-webhook` | Stripe | Verifies the signature; on `checkout.session.completed` grants the Stripe flag. |
| `revenuecat-webhook` | RevenueCat | Checks the shared secret (constant-time); grants on purchase events, revokes on `EXPIRATION` / `REFUND`; ignores anonymous ids. |
| `delete-account` | App, `POST` with a Firebase ID token | Deletes the user's Firestore documents, then the auth user. Token checked with `checkRevoked`. |
| `_entitlements` | shared | The per-source flag logic above. |
| `_firebaseAdmin` | shared | Admin SDK from server-only env (`FIREBASE_*`, never `VITE_`). |

Every function that acts on a user takes the uid **from a verified ID token**,
never from the request body. The Admin SDK bypasses Firestore rules, which is
what lets webhooks write fields the client cannot.

## Build, SEO and deploy

`npm run build` runs Vite, and the `seoPages` plugin in `vite.config.js` runs in
`closeBundle`, after `public/` is copied, to emit:

- `dist/cocktails/<slug>.html` for every recipe — title, description, canonical,
  `Recipe` + `HowToStep` + `BreadcrumbList` JSON-LD, and step-by-step
  instructions from `buildSteps`, cross-linked by base spirit;
- `dist/cocktails/index.html`, a `CollectionPage`;
- `dist/sitemap.xml`, replacing any static one.

The pages exist because the app is a client-rendered SPA and a crawler's first
fetch sees an empty `<div id="root">`. They are generated from the identical
data and derivations the app uses, which is what keeps them from being the kind
of thin, inconsistent generated content that gets a site rejected. See
[docs/seo.md](docs/seo.md).

`netlify.toml` serves `/privacy` and then a SPA catch-all. Netlify serves an
existing file in preference to a rewrite, which is the only reason the 321
static pages survive the catch-all — it must never gain `force = true`. The
plugin clears `dist` itself with a retry, because on Windows Dropbox and Defender
hold handles on fresh files; `emptyOutDir` stays `false`.

## Security model

- **`firestore.rules` is the boundary.** Clients ship all the monetization code
  and every `VITE_` value is inlined into the bundle by design; none of that is
  secret and none of it is trusted.
- Clients may write only `progress` and `updatedAt` on their own document.
  Entitlement flags are written only by server functions using the Admin SDK.
- `VITE_ADMIN_EMAILS` only hides the admin UI. The real gate is the `admins()`
  list in `firestore.rules`, which must be kept in step with it.
- Server secrets (`STRIPE_*`, `REVENUECAT_WEBHOOK_SECRET`, `FIREBASE_*` service
  account) live in Netlify's environment and are never prefixed `VITE_`.
- Webhooks verify their caller: Stripe by signature, RevenueCat by a
  constant-time secret comparison.

## Configuration

`.env.example` documents every variable. Two things about it are easy to get
wrong:

- **`VITE_*` is inlined at build time**, and because the Play shell loads the
  deployed site, the build that reaches phones is **Netlify's**. Values set only
  in a local `.env` affect `npm run dev` and nothing else.
- `REVENUECAT_ENTITLEMENT` (server) and `VITE_REVENUECAT_ENTITLEMENT` (client)
  must be the same string, or the webhook ignores the events the app generates.

## Development

```
npm run dev       # Vite dev server on http://localhost:5173
npm run build     # bundle + 321 static recipe pages + sitemap into dist/
npm run preview   # serve dist/
npm run lint      # eslint
```

- **Firebase is optional locally.** With no `VITE_FIREBASE_*`, `firebaseEnabled`
  is false, sign-in is disabled, and everything runs against `localStorage`.
- **Lint.** The source has five findings, all in `App.jsx`: three
  `react-hooks/set-state-in-effect`, one `react-hooks/purity`, one `no-empty`.
  On a machine that has run a Capacitor sync or a Gradle build, `npm run lint`
  reports around 829 instead — `eslint.config.js` ignores only `dist/`, so the
  untracked, gitignored bundle copies and intermediates under `android/` are
  linted too. That noise is machine-dependent and not in git; adding `android`
  to `globalIgnores` would remove it. Judge a change by whether the `src/`
  count moves.
- **There is no test suite.** The verification standard for a change is: the
  build passes, derived output is diffed across all 321 recipes against the
  previous state, and UI changes are driven in a real browser against the dev
  server (Playwright works; the dev server is on 5173).
- **Line endings.** `.gitattributes` normalises text to LF in the repo and pins
  Gradle and shell files to LF; expect "LF will be replaced by CRLF" warnings on
  Windows and ignore them.
- **Branches.** Work goes on `2026/MM/ss/<topic>` branches and is merged into
  `dev` by pull request; `master` is the release branch.
- **Editing recipes.** Keep one recipe per line, vulgar fractions, and build
  order. Run the build afterwards: the static page generator will surface a
  recipe that no longer parses. If you add a `method`, `order` or `serve`
  override, add the source to `docs/methods.md`.

## Further reading

| Document | Covers |
|---|---|
| [docs/methods.md](docs/methods.md) | Every method, order and serve override with its source; the drinks checked and left alone; known gaps in the rules. |
| [docs/seo.md](docs/seo.md) | The static recipe pages, why they exist, what to check after deploying. |
| [docs/pwa.md](docs/pwa.md) | The service worker, its path, and why it is network-first. |
| [docs/consent.md](docs/consent.md) | GDPR consent on web and Android, and what happens when ads do not come. |
| [docs/mobile-google-signin.md](docs/mobile-google-signin.md) | Native Google sign-in for the Capacitor build, and diagnosing failures. |
| [docs/mobile-monetization.md](docs/mobile-monetization.md) | AdMob, Play Billing and RevenueCat setup, phase by phase. |

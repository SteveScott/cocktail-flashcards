# Working in this repository

`README.md` is the real documentation — a full tour of the data, the rule
process, the app, storage and sync, monetization and the build. Read the section
you need before changing anything near it. This file holds only what the README
does not: the branch convention, and the traps that are invisible from the code
you happen to be editing.

## Branches

**Develop against `dev`, never `master`.** `dev` is the integration branch and
`master` is the release branch; feature branches PR into `dev`, and `dev` PRs
into `master`. Branching from `master` gets you a base that can be a dozen
commits stale, and a conflict in `src/cocktails.json` that git cannot align.

```
git fetch origin dev
git checkout -b <your-branch> origin/dev
```

## Checks

```
npm run lint     # eslint
npm test         # node test files in tests/
npm run build    # vite + the SEO page generator
```

Node 24 (`.nvmrc`). `npm run build` regenerates the static recipe pages; the
plugin prints the page and sitemap counts, which should not move unless you
meant them to.

## Text: which things take capitals

Not in the README, and easy to get wrong because there are two rules, not one.

**Data — `src/cocktails.json`**

| | Convention | Examples |
|---|---|---|
| `glass`, `method`, `serve` | Title Case, minor words down | `Coupe or Nick & Nora`, `Built, Not Stirred`, `On the Rocks` |
| Cocktail names | Title Case, parentheticals too | `Gimlet (Classic)`, `Piña Colada (Frozen)` |
| Measured components | Title Case | `2 oz Fresh Lime Juice`, `1 Sugar Cube` |
| Garnishes (unmeasured) | **sentence case** | `Orange peel`, `Grated nutmeg`, `Flamed orange peel` |
| Placement markers | lower case | `(garnish)`, `(top)`, `(optional)`, `(float)` |

Garnishes are the one that surprises people: `Lime wedge`, not `Lime Wedge`.
Each coordinated element starts its own phrase, so `Lemon peel or Olive` is
right. Brand names keep their capitals anywhere — `Angostura Bitters`,
`Punt e Mes`.

**UI — `src/App.jsx`**

Controls and headings are Title Case (`Check Answer`, `Restore Study Progress`,
`Colour Scheme`, `Your Deck Is Empty`). Body copy, error messages and
confirmation prompts are sentence case (`Cloud sync failed`, `Clear all tried
marks?`). A label that reads as a sentence stays a sentence.

`Sign in with Google` and `Sign in with Facebook` are the providers' required
button text. Leave them, and leave `Sign in` / `Sign out` alongside them, or
they become the odd ones out.

## Traps

**Cocktail names are progress keys.** Scores, the learned list, the tried list
and the deck are all keyed by the exact `name` string. Renaming a cocktail
resets that card for everyone who had studied it, and leaves an orphan key in
their account. `learned` is filtered against the pool on read, so a stale key
cannot inflate a count — but the progress is gone. Names also feed `slugify`,
so a rename can move a recipe URL; check that the slug is unchanged before
deciding a rename is free.

**`serve` is compared by value, not by pattern.** `getMethod`, `serveTarget` and
`buildSteps` in `src/recipe-meta.js` switch on the literal string. Change a
`serve` value in the data and every one of those comparisons has to move with
it, or the prose degrades silently through a `default` branch that still
returns something plausible. The same is true of `method`.

**`ingredientLabel` does not fold case.** Two spellings of one ingredient become
two entries in the 86 It lexicon, and the quiz can then offer both — a question
decidable only by reading the capital letters, which no player can win. After
touching ingredient strings, check the lexicon has no case clashes:

```js
const seen = new Map();
for (const e of buildLexicon(all)) {
  const k = e.label.toLowerCase();
  (seen.get(k) ?? seen.set(k, []).get(k)).push(e.label);
}
// any key with more than one distinct spelling is a bug
```

**`src/recipe-meta.js` runs in two places** — the browser bundle and the Node
build-time page generator — so it must stay free of React, DOM and Node APIs.
One copy is what stops a recipe page contradicting the flashcard for the same
drink.

**The parser reads the string as written.** Measures lead, unmeasured trailing
items are garnish, and parentheticals may contain commas (`splitParts` respects
them). README → *Ingredient string conventions* has the full set. Three app
surfaces plus the generator render ingredient rows; they share a helper rather
than splitting on `", "` by hand.

## After changing recipe data

Diff the derived values before and after, rather than trusting a clean build.
`slugify`, `getMethod` and `baseSpirit` over every recipe should be identical
unless you meant to move one:

```
node -e "import('./src/recipe-meta.js').then(async m=>{
  const d=JSON.parse((await import('fs')).readFileSync('src/cocktails.json','utf8'));
  for (const c of [...d.top50,...d.master150])
    console.log([m.slugify(c.name),m.getMethod(c),m.baseSpirit(c)].join('|'));
})"
```

## Conventions worth matching

Commit messages and PR titles here are declarative sentences about the change,
not ticket-speak — *"Split the ambiguous Built method into Built, Stirred and
Built, Not Stirred"*. Comments explain why a rule exists and what broke without
it, often naming the specific drink that forced it. Match that when you add one.

# SEO

## What's in place

All of it is static, in `index.html` — not set from React. That's the whole
point: the app is a client-rendered SPA, so a crawler's **first** fetch of any
URL gets `<div id="root"></div>` and nothing else. Google does execute JS, but
on a second, queued pass that is slower and less reliable than the initial HTML
parse. Anything that matters for search has to be in the first byte stream.

- **`<title>`** — `Cocktail Flashcards — Learn 300+ Classic Drink Recipes` (54
  chars). Google shows roughly 60; the old bare `Cocktail Flashcards` used 19 of
  them and carried no query terms.
- **`<meta name="description">`** — 154 chars. Previously **absent entirely**,
  which meant Google was synthesising a snippet from a page that has almost no
  crawlable text. This is the line that appears under the title in results.
- **`rel=canonical`** → `https://cocktailflashcards.com/`. The Play app loads
  this same site at `/?platform=play`, and `netlify.toml` rewrites `/*` to the
  app shell with a 200, so an unbounded number of URLs return byte-identical
  content. Canonical is what stops them competing with the homepage.
- **Open Graph + Twitter cards**, with `public/og-image.jpg` (2400×1252, the
  1.91:1 ratio both networks want). Shared links previously rendered as bare
  URLs.
- **JSON-LD `WebApplication`.** No `aggregateRating` — there are no real ratings
  to cite and fabricating them is squarely against Google's structured-data spam
  policy. Add it when the Play listing has genuine numbers to mirror.
- **`public/robots.txt`** and **`public/sitemap.xml`**.

### Why robots.txt doesn't block `?platform=play`

It would be the obvious move and it's the wrong one. `Disallow` prevents
*crawling*, and a URL that is never crawled is a URL whose `rel=canonical` is
never read — so the duplicate would stay unconsolidated and could still be
indexed from external links, just without any of the signals that point it at
the homepage. Let it be crawled; let the canonical do the work.

## Static recipe pages

`scripts/seo-pages.mjs` is a Vite plugin that runs in `closeBundle` and turns
`src/cocktails.json` into **321 static recipe pages** plus a browse-all index:

- `/cocktails/<slug>` — one per drink, each with its own `<title>`,
  description, canonical, Open Graph tags, `Recipe` + `BreadcrumbList`
  structured data, and up to 8 cross-links to other drinks on the same base
  spirit.
- `/cocktails/` — the full index, grouped by base spirit.
- `/sitemap.xml` — regenerated every build, 324 URLs. **Do not add a static
  `public/sitemap.xml`**; the generated one would overwrite it and the two would
  drift.

That takes the site from 1 indexable page to 323, each targeting a query someone
actually types (*sazerac recipe*, *what's in a paper plane*), with no new prose
to write and no drift risk — `src/cocktails.json` stays the single source.

### Why the pages aren't thin

This matters more than usual here, because the site has been rejected by AdSense
once already, and AdSense is the ad network again (PropellerAds, tried in
between, does not permit alcohol advertising). Mass-generated pages are their own
rejection category —
"scraped or auto-generated content with little added value" — so 321 pages
carrying nothing but a name and an ingredient line would deepen the hole rather
than fill it.

Each page therefore carries something the raw JSON does not: **worked
step-by-step instructions**, composed in `buildSteps()` from the method,
glassware and garnish. The flashcards teach the ingredient list; these pages
teach the execution. The data is also the site's own, not scraped from anywhere.

Two invariants keep it that way, both enforced by a check after every build:

1. **Every title and description is unique.** Reusing them across pages would
   collapse all 321 into one duplicate cluster and waste the whole exercise.
2. **No broken internal links.** The cross-link neighbours are picked
   deterministically (alphabetical successors, wrapping) rather than at random,
   so the internal link graph is stable across deploys instead of churning.

### Shared derivations

`src/recipe-meta.js` holds everything derived from a recipe — method, base
spirit, slug, ingredient parsing, build steps. Both `App.jsx` and the generator
import it, so a recipe page can never claim a different method than the
flashcard for the same drink. A visible contradiction between two pages on the
same site is precisely the kind of quality signal that gets a domain rejected.

### Routing

Pages are emitted flat, as `cocktails/<slug>.html`, and Netlify serves those at
the extensionless `/cocktails/<slug>`. The earlier `<slug>/index.html` layout
gave identical URLs but created 322 directories per build, which is slower and
much more prone to the file-locking described below.

They are real files, and Netlify serves an existing file ahead of a rewrite
rule, so the `/*` → `/index.html` SPA catch-all in `netlify.toml` does not
swallow them. That rule must never gain `force = true` — see the comment there.

### Why the plugin empties dist itself

`vite.config.js` sets `build.emptyOutDir: false` and the plugin clears outDir in
`buildStart` instead. This is not stylistic. Vite's clean is a single `rmSync`
with no retry; on Windows, Dropbox and Defender open handles on newly written
files and hold them for a second or two, and adding 300+ files to `dist` widened
that window enough that every repeat `npm run build` failed with `EPERM`. The
plugin's `rmWithRetry` waits the handles out. Linux — where Netlify builds —
never sees the error, so this costs nothing there.

## Known data issues surfaced by this work

- **`Blood & Sand` and `Blood and Sand` are the same drink, entered twice.** The
  generator skips the duplicate (it would be self-inflicted duplicate content)
  and warns at build time, but the deck itself still teaches the card twice.
  Worth fixing in `cocktails.json`.
- The `ALL_200` constant in `App.jsx` actually holds 322 entries. Cosmetic, but
  misleading.

## After deploying

1. Verify the domain in Google Search Console and submit
   `https://cocktailflashcards.com/sitemap.xml`.
2. Run a recipe page through the Rich Results Test — it should report a valid
   **Recipe** and **Breadcrumb**.
3. Check the card renders in Facebook's Sharing Debugger; it caches
   aggressively, so scrape once to prime the new image.
4. Give Google a few weeks to crawl 323 new URLs before re-applying to any ad
   network. Re-applying the day after deploy means they review the same thin
   site they already rejected.

// Build-time generator for the static recipe pages.
//
// WHY THIS EXISTS
// ---------------
// The app is one client-rendered route. To a crawler that is a single page
// containing no recipe text at all — every one of the 322 recipes is locked
// inside an 840 KB JS bundle. That is almost certainly why AdSense looked at the
// site and saw a thin shell.
//
// This plugin turns the JSON the app already ships into real HTML: one page per
// drink, each with its own title, description, canonical and Recipe structured
// data, cross-linked by base spirit, all listed in a generated sitemap.
//
// ON NOT BEING THIN
// -----------------
// Auto-generated pages are a policy risk in their own right — "scraped or
// auto-generated content with little added value" is its own rejection reason,
// so 322 pages of nothing but a name and an ingredient line would make the
// problem worse, not better. Every page here therefore carries something the
// raw data does not: worked step-by-step instructions derived from the method,
// glassware and garnish, plus genuine cross-links. The recipe data is the
// site's own, not scraped.
//
// Runs in `closeBundle`, i.e. after Vite has copied public/ into dist, so the
// generated sitemap.xml legitimately replaces any static one.

import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  slugify, getMethod, baseSpirit, parseIngredients, buildSteps, summarize,
} from "../src/recipe-meta.js";

const SITE = "https://cocktailflashcards.com";

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// JSON-LD goes inside a <script> element, where the only sequence that can
// break out is "</script>". Escaping the slash neutralises it.
const jsonld = (o) => JSON.stringify(o, null, 2).replace(/</g, "\\u003c");

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;padding:0;background:#0f172a;color:#cbd5e1;
  font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#60a5fa}
.wrap{max-width:44rem;margin:0 auto;padding:1.5rem 1.25rem 4rem}
nav.crumb{font-size:.85rem;color:#64748b;margin-bottom:1.5rem}
nav.crumb a{color:#94a3b8;text-decoration:none}
nav.crumb a:hover{text-decoration:underline}
h1{color:#f8fafc;font-size:2rem;line-height:1.15;margin:0 0 .5rem}
.lede{font-size:1.05rem;color:#94a3b8;margin:0 0 1.5rem}
.facts{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 2rem;padding:0;list-style:none}
.facts li{background:#1e293b;border:1px solid #334155;border-radius:999px;
  padding:.25rem .75rem;font-size:.82rem;color:#e2e8f0}
h2{color:#f8fafc;font-size:1.2rem;margin:2.5rem 0 .75rem}
ul.ing{list-style:none;padding:0;margin:0}
ul.ing li{padding:.5rem 0;border-bottom:1px solid #ffffff0d;display:flex;gap:.75rem}
ul.ing .m{color:#f8fafc;font-weight:700;min-width:5.5rem;flex-shrink:0}
ol.steps{padding-left:1.25rem;margin:0}
ol.steps li{margin:.6rem 0}
.rel{display:flex;flex-wrap:wrap;gap:.5rem;padding:0;margin:0;list-style:none}
.rel a{display:inline-block;background:#1e293b;border:1px solid #334155;
  border-radius:.5rem;padding:.4rem .7rem;font-size:.9rem;text-decoration:none;color:#e2e8f0}
.rel a:hover{border-color:#60a5fa;color:#fff}
.cta{display:block;margin:2.5rem 0 0;background:#1e293b;border:1px solid #334155;
  border-left:3px solid #60a5fa;border-radius:.5rem;padding:1rem 1.25rem;
  text-decoration:none;color:#cbd5e1}
.cta:hover{border-color:#60a5fa}
.cta strong{color:#f8fafc;display:block;margin-bottom:.2rem}
footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid #1e293b;
  font-size:.85rem;color:#64748b}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.5rem;
  padding:0;margin:0;list-style:none}
.grid a{display:block;background:#1e293b;border:1px solid #334155;border-radius:.5rem;
  padding:.6rem .8rem;text-decoration:none;color:#e2e8f0;font-size:.92rem}
.grid a:hover{border-color:#60a5fa;color:#fff}
.grid .sub{display:block;color:#64748b;font-size:.78rem;margin-top:.15rem}
`.trim();

function shell({ title, description, canonical, body, ld }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta name="theme-color" content="#0f172a" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${SITE}/og-image.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="stylesheet" href="/recipe.css" />
${ld.map(o => `<script type="application/ld+json">\n${jsonld(o)}\n</script>`).join("\n")}
</head>
<body>
<div class="wrap">
${body}
<footer>
  <a href="/">Cocktail Flashcards</a> &middot;
  <a href="/cocktails/">All recipes</a> &middot;
  <a href="/privacy">Privacy</a>
</footer>
</div>
</body>
</html>
`;
}

function recipePage(c, related) {
  const method = getMethod(c);
  const spirit = baseSpirit(c);
  const { components, garnishes } = parseIngredients(c.ingredients);
  const steps = buildSteps(c);
  const slug = slugify(c.name);
  const canonical = `${SITE}/cocktails/${slug}`;
  const title = `${c.name} Recipe — Ingredients, Ratios & Method`;
  const description = `How to make a ${c.name}: ${summarize(c).replace(/^A /, "a ")} Full ingredient list, measurements and step-by-step instructions.`;

  const body = `
<nav class="crumb"><a href="/">Home</a> / <a href="/cocktails/">Cocktails</a> / ${esc(c.name)}</nav>
<h1>${esc(c.name)}</h1>
<p class="lede">${esc(summarize(c))}</p>
<ul class="facts">
  <li>${esc(method)}</li>
  <li>${esc(c.glass || "—")}</li>
  ${c.serve ? `<li>${esc(c.serve)}</li>` : ""}
  <li>${esc(spirit)}</li>
  ${c.rank ? `<li>#${c.rank} most essential</li>` : ""}
</ul>

<h2>Ingredients</h2>
<ul class="ing">
${components.map(x => `  <li><span class="m">${esc(x.measure)}</span><span>${esc(x.item)}</span></li>`).join("\n")}
${garnishes.map(g => `  <li><span class="m">Garnish</span><span>${esc(g)}</span></li>`).join("\n")}
</ul>

<h2>How to make a ${esc(c.name)}</h2>
<ol class="steps">
${steps.map(s => `  <li>${esc(s)}</li>`).join("\n")}
</ol>

${related.length ? `<h2>Related ${esc(spirit)} cocktails</h2>
<ul class="rel">
${related.map(r => `  <li><a href="/cocktails/${slugify(r.name)}/">${esc(r.name)}</a></li>`).join("\n")}
</ul>` : ""}

<a class="cta" href="/">
  <strong>Learn this one by heart</strong>
  Study the ${esc(c.name)} and 300+ other classics as spaced-repetition flashcards — free, works offline.
</a>`;

  const recipeLd = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: `${c.name} Cocktail`,
    url: canonical,
    description: summarize(c),
    recipeCategory: "Cocktail",
    recipeCuisine: "Cocktail",
    recipeYield: "1 cocktail",
    keywords: [c.name, `${c.name} recipe`, spirit, method].join(", "),
    recipeIngredient: [...components.map(x => x.text), ...garnishes],
    recipeInstructions: steps.map((s, i) => ({
      "@type": "HowToStep", position: i + 1, text: s,
    })),
    tool: [c.glass].filter(Boolean),
  };

  const crumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Cocktails", item: `${SITE}/cocktails/` },
      { "@type": "ListItem", position: 3, name: c.name, item: canonical },
    ],
  };

  return shell({ title, description, canonical, body, ld: [recipeLd, crumbLd] });
}

function indexPage(groups, total) {
  const canonical = `${SITE}/cocktails/`;
  const body = `
<nav class="crumb"><a href="/">Home</a> / Cocktails</nav>
<h1>All ${total} Cocktail Recipes</h1>
<p class="lede">Every recipe in the Cocktail Flashcards deck, grouped by base spirit.
Each one lists ingredients, measurements, glassware and step-by-step method.</p>
${[...groups.entries()].map(([spirit, list]) => `
<h2>${esc(spirit)} <span style="color:#64748b;font-weight:400;font-size:.9rem">(${list.length})</span></h2>
<ul class="grid">
${list.map(c => `  <li><a href="/cocktails/${slugify(c.name)}">${esc(c.name)}<span class="sub">${esc(getMethod(c))} &middot; ${esc(c.glass || "")}</span></a></li>`).join("\n")}
</ul>`).join("\n")}
<a class="cta" href="/">
  <strong>Study these as flashcards</strong>
  Spaced repetition and quizzes for all ${total} recipes — free, works offline, syncs across devices.
</a>`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `All ${total} Cocktail Recipes`,
    url: canonical,
    description: `A complete index of ${total} classic cocktail recipes with ingredients, measurements and method.`,
  };
  return shell({
    title: `All ${total} Classic Cocktail Recipes — Ingredients & Method`,
    description: `Browse ${total} classic cocktail recipes by base spirit. Ingredients, exact measurements, glassware and step-by-step instructions for every drink.`,
    canonical, body, ld: [ld],
  });
}

function sitemap(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/seo-pages.mjs at build time. Do not edit by hand. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ loc, priority, changefreq }) => `  <url>
    <loc>${loc}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
}

// Remove a path, retrying briefly while Windows reports it busy.
//
// On Windows, Dropbox and Defender open handles on files the moment they appear
// and hold them for a second or two. Vite's own `emptyOutDir` does a single
// rmSync with no retry, so a second `npm run build` inside that window dies with
// EPERM. Adding 300+ files to dist widened that window enough to make it hit
// every time, so this plugin takes over clearing outDir (vite.config.js sets
// `emptyOutDir: false` to hand the job over) and retries until the handles drop.
// A no-op on Linux, where Netlify builds and the error never occurs.
async function rmWithRetry(path, attempts = 30, delayMs = 300) {
  for (let i = 1; ; i++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i >= attempts || !["EPERM", "EBUSY", "ENOTEMPTY"].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

export function seoPages(cocktails) {
  let out = "dist";
  return {
    name: "seo-recipe-pages",
    apply: "build",
    configResolved(config) {
      out = config.build.outDir;
    },
    // Replaces Vite's own emptyOutDir (disabled in vite.config.js) so the clean
    // is retried rather than failing the build. See rmWithRetry above.
    async buildStart() {
      await rmWithRetry(out);
    },
    async closeBundle() {

      // One page per unique slug. "Blood & Sand" and "Blood and Sand" are the
      // same drink entered twice, and shipping both would be self-inflicted
      // duplicate content — exactly the signal we're trying to fix.
      const bySlug = new Map();
      const collisions = [];
      for (const c of cocktails) {
        const s = slugify(c.name);
        if (bySlug.has(s)) { collisions.push(`${c.name} ≡ ${bySlug.get(s).name}`); continue; }
        bySlug.set(s, c);
      }
      const unique = [...bySlug.values()];

      // Group for the index page and for cross-linking.
      const groups = new Map();
      for (const c of unique) {
        const k = baseSpirit(c);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
      }
      for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
      const sorted = new Map([...groups.entries()].sort((a, b) => b[1].length - a[1].length));

      await mkdir(join(out, "cocktails"), { recursive: true });
      await writeFile(join(out, "recipe.css"), STYLE, "utf8");

      for (const c of unique) {
        const slug = slugify(c.name);
        const siblings = groups.get(baseSpirit(c)).filter(x => x.name !== c.name);
        // Deterministic neighbours, not random, so the internal link graph is
        // stable across builds instead of churning every deploy.
        const start = siblings.findIndex(x => x.name.localeCompare(c.name) > 0);
        const related = siblings.length
          ? Array.from({ length: Math.min(8, siblings.length) },
              (_, i) => siblings[(Math.max(0, start) + i) % siblings.length])
          : [];
        // Flat file, not <slug>/index.html. Netlify serves cocktails/negroni.html
        // at /cocktails/negroni, so the URL is identical either way — but this
        // creates one directory instead of 322, which builds faster and avoids
        // the Windows file-locking that mass directory creation provokes when the
        // repo sits in a synced folder.
        await writeFile(join(out, "cocktails", `${slug}.html`), recipePage(c, related), "utf8");
      }

      await writeFile(join(out, "cocktails", "index.html"), indexPage(sorted, unique.length), "utf8");

      await writeFile(join(out, "sitemap.xml"), sitemap([
        { loc: `${SITE}/`, changefreq: "weekly", priority: "1.0" },
        { loc: `${SITE}/cocktails/`, changefreq: "weekly", priority: "0.9" },
        ...unique.map(c => ({
          loc: `${SITE}/cocktails/${slugify(c.name)}`,
          changefreq: "monthly",
          priority: c.rank ? "0.8" : "0.6",
        })),
        { loc: `${SITE}/privacy`, changefreq: "yearly", priority: "0.1" },
      ]), "utf8");

      const msg = `seo-recipe-pages: ${unique.length} recipe pages + index, ${unique.length + 3} sitemap URLs`;
      // `this.info`/`this.warn` return undefined, so a `??` fallback would
      // always ALSO fire and log twice. Branch on the method instead.
      if (this.info) this.info(msg); else console.log(msg);
      if (collisions.length) {
        const w = `duplicate recipe names skipped: ${collisions.join("; ")}`;
        if (this.warn) this.warn(w); else console.warn(w);
      }
    },
  };
}

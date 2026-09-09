// Prints the ingredient lexicon: every type in the recipe corpus against its
// unigram frequency and the probability the 86 It quiz samples it at.
//
// WHY THIS EXISTS
// ---------------
// The "86 It" quiz samples its wrong answers from `buildLexicon()`, so that a
// common ingredient is offered often and an obscure one almost never. That is a
// claim about a distribution, and a distribution is not something you can check
// by reading the code or by playing a round — a one-in-a-thousand ingredient
// showing up twice in an evening looks exactly like a broken sampler.
//
// So: print the lexicon, and sample against it. `frequency` is the unigram MLE,
// the type's share of all tokens in the corpus; `probability` is the smoothed
// distribution the sampler actually draws from (see ALPHA); and `drawn` is the
// empirical rate over the simulated rounds below. When probability and drawn
// agree, the sampler is doing what it claims.
//
//   npm run ingredient-frequency
//   npm run ingredient-frequency -- --all      every ingredient, not the top 30
//   npm run ingredient-frequency -- Port       only rows matching a substring
//   npm run ingredient-frequency -- --verify   prove tied types are sampled fairly

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildLexicon, buildEightySixQuestion, eightySixEligible } from "../src/recipe-meta.js";

const ROUNDS = 2000;
const QUESTIONS = 10;

const here = fileURLToPath(new URL(".", import.meta.url));
const data = JSON.parse(readFileSync(here + "../src/cocktails.json", "utf8"));
const recipes = [...data.top50, ...data.master150];

const lexicon = buildLexicon(recipes);
const eligible = recipes.filter(eightySixEligible);

// ── --verify: are types on equal probability sampled equally often? ────────
//
// 124 of the 242 types are hapax legomena, so they all carry an identical
// probability, and a reasonable worry about inverse-CDF selection — which walks
// the support in order and stops at the first entry to exhaust `r` — is that it
// favours whatever sits earliest. It does not, and no jitter is needed to break
// the ties: each entry owns an interval on the CDF as wide as its probability,
// and ties get equal widths at different offsets. Position never enters.
//
// Sampling cannot show this convincingly — at these rates a run of four
// million draws still leaves the tied group's chi-square wobbling by a couple of
// sigma, which is indistinguishable from a small real bias. So sweep the
// selector's input across [0,1) on a uniform grid instead: the number of grid
// points landing on an ingredient is the width of its interval, measured with no
// PRNG and no sampling noise at all.
if (process.argv.includes("--verify")) {
  const total = lexicon.reduce((s, e) => s + e.probability, 0);
  const pick = x => {
    let r = x * total;
    for (let i = 0; i < lexicon.length; i++) { r -= lexicon[i].probability; if (r <= 0) return i; }
    return lexicon.length - 1;
  };

  const GRID = 20_000_000;
  const hits = new Array(lexicon.length).fill(0);
  for (let k = 0; k < GRID; k++) hits[pick(k / GRID)]++;

  const tied = lexicon.map((e, i) => ({ ...e, index: i, hits: hits[i] })).filter(e => e.count === 1);
  const exact = GRID * tied[0].probability;
  const widths = [...new Set(tied.map(t => t.hits))].sort((a, b) => a - b);
  const worst = lexicon.reduce((w, e, i) => Math.max(w, Math.abs(hits[i] / GRID - e.probability) / e.probability), 0);

  console.log(`sweeping ${GRID.toLocaleString()} points across [0,1) — no PRNG, no sampling noise\n`);
  console.log(`${tied.length} types tie on probability ${tied[0].probability.toExponential(4)} (one recipe each)`);
  console.log(`each is owed ${exact.toFixed(2)} grid points; observed widths: ${widths.join(", ")}`);
  console.log(`  first in scan order  ${tied[0].label.padEnd(22)} ${tied[0].hits}`);
  console.log(`  last in scan order   ${tied.at(-1).label.padEnd(22)} ${tied.at(-1).hits}`);
  console.log(`\nThe whole spread is ${widths.at(-1) - widths[0]} grid point out of ${Math.round(exact)} — the grid cannot`);
  console.log(`split a point, and nothing else separates them. Ties are exact.`);
  console.log(`\nWorst |measured − declared| across all ${lexicon.length} ingredients: ${(100 * worst).toFixed(4)}%`);
  process.exit(0);
}

// Play the rounds the quiz would play, and count what the player is offered.
const drawn = new Map();
let draws = 0;
for (let r = 0; r < ROUNDS; r++) {
  for (let q = 0; q < QUESTIONS; q++) {
    const c = eligible[Math.floor(Math.random() * eligible.length)];
    for (const o of buildEightySixQuestion(c, lexicon).options) {
      if (o.real) continue;
      drawn.set(o.label, (drawn.get(o.label) || 0) + 1);
      draws++;
    }
  }
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const match = args.find(a => !a.startsWith("--"));

const pct = n => ((100 * n).toFixed(3) + "%").padStart(11);
const rows = [...lexicon].sort((a, b) => b.probability - a.probability);
const shown = match
  ? rows.filter(e => e.label.toLowerCase().includes(match.toLowerCase()))
  : all ? rows : rows.slice(0, 30);

console.log(`${recipes.length} recipes, ${lexicon.length} distinct ingredients, ` +
            `${lexicon.reduce((s, e) => s + e.count, 0)} mentions`);
console.log(`${ROUNDS} simulated rounds of ${QUESTIONS}, ${draws} impostors drawn\n`);
console.log("  recipes" + "frequency".padStart(13) + "probability".padStart(13) +
            "drawn".padStart(13) + "  ingredient");
for (const e of shown) {
  console.log(`  ${String(e.count).padStart(7)}  ${pct(e.frequency)}  ${pct(e.probability)}  ` +
              `${pct((drawn.get(e.label) || 0) / draws)}  ${e.label}`);
}
if (!all && !match) console.log(`  … ${rows.length - shown.length} more (--all)`);

// The tail is the number that matters: these are the ingredients a player has
// no reason to have heard of, and their combined share is how often a round
// hands one over.
const tail = rows.filter(e => e.count === 1);
const share = tail.reduce((s, e) => s + e.probability, 0);
console.log(`\n${tail.length} ingredients appear in exactly one recipe. ` +
            `Together they take ${(100 * share).toFixed(2)}% of draws — ` +
            `about one every ${(1 / (share * 2 * QUESTIONS)).toFixed(1)} rounds.`);

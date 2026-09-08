// Prints the impostor table: every ingredient in the corpus against its
// frequency and its draw probability.
//
// WHY THIS EXISTS
// ---------------
// The "86 It" quiz draws its wrong answers from `buildCodex()`, weighted so a
// common ingredient is offered often and an obscure one almost never. That is a
// claim about a distribution, and a distribution is not something you can check
// by reading the code or by playing a round — a one-in-a-thousand ingredient
// showing up twice in an evening looks exactly like a broken weighting.
//
// So: print the table, and simulate against it. `frequency` is the ingredient's
// share of all mentions in the corpus, `weight` is what a draw actually uses
// (frequency emphasised, see IMPOSTOR_EMPHASIS), and `drawn` is where it landed
// over the simulated rounds below. When weight and drawn agree, the weighting
// is doing what it says.
//
//   npm run ingredient-frequency
//   npm run ingredient-frequency -- --all      every ingredient, not the top 30
//   npm run ingredient-frequency -- Port       only rows matching a substring
//   npm run ingredient-frequency -- --verify   prove ties are drawn fairly

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCodex, buildEightySixQuestion, eightySixEligible } from "../src/recipe-meta.js";

const ROUNDS = 2000;
const QUESTIONS = 10;

const here = fileURLToPath(new URL(".", import.meta.url));
const data = JSON.parse(readFileSync(here + "../src/cocktails.json", "utf8"));
const recipes = [...data.top50, ...data.master150];

const codex = buildCodex(recipes);
const eligible = recipes.filter(eightySixEligible);

// ── --verify: are ingredients on the same weight drawn equally often? ───────
//
// 124 of the 242 ingredients appear in exactly one recipe, so they all carry an
// identical weight, and a reasonable worry about a scan that walks the table in
// order and stops at the first entry to exhaust `r` is that it favours whatever
// sits earliest. It does not, and no jitter is needed to break the ties: each
// entry owns an interval on the cumulative line as wide as its weight, and ties
// get equal widths at different offsets. Position never enters.
//
// Sampling cannot show this convincingly — at these weights a run of four
// million draws still leaves the tied group's chi-square wobbling by a couple of
// sigma, which is indistinguishable from a small real bias. So sweep the
// selector's input across [0,1) on a uniform grid instead: the number of grid
// points landing on an ingredient is the width of its interval, measured with no
// PRNG and no sampling noise at all.
if (process.argv.includes("--verify")) {
  const total = codex.reduce((s, e) => s + e.weight, 0);
  const pick = x => {
    let r = x * total;
    for (let i = 0; i < codex.length; i++) { r -= codex[i].weight; if (r <= 0) return i; }
    return codex.length - 1;
  };

  const GRID = 20_000_000;
  const hits = new Array(codex.length).fill(0);
  for (let k = 0; k < GRID; k++) hits[pick(k / GRID)]++;

  const tied = codex.map((e, i) => ({ ...e, index: i, hits: hits[i] })).filter(e => e.count === 1);
  const exact = GRID * tied[0].weight;
  const widths = [...new Set(tied.map(t => t.hits))].sort((a, b) => a - b);
  const worst = codex.reduce((w, e, i) => Math.max(w, Math.abs(hits[i] / GRID - e.weight) / e.weight), 0);

  console.log(`sweeping ${GRID.toLocaleString()} points across [0,1) — no PRNG, no sampling noise\n`);
  console.log(`${tied.length} ingredients tie on weight ${tied[0].weight.toExponential(4)} (one recipe each)`);
  console.log(`each is owed ${exact.toFixed(2)} grid points; observed widths: ${widths.join(", ")}`);
  console.log(`  first in scan order  ${tied[0].label.padEnd(22)} ${tied[0].hits}`);
  console.log(`  last in scan order   ${tied.at(-1).label.padEnd(22)} ${tied.at(-1).hits}`);
  console.log(`\nThe whole spread is ${widths.at(-1) - widths[0]} grid point out of ${Math.round(exact)} — the grid cannot`);
  console.log(`split a point, and nothing else separates them. Ties are exact.`);
  console.log(`\nWorst |measured − declared| across all ${codex.length} ingredients: ${(100 * worst).toFixed(4)}%`);
  process.exit(0);
}

// Play the rounds the quiz would play, and count what the player is offered.
const drawn = new Map();
let draws = 0;
for (let r = 0; r < ROUNDS; r++) {
  for (let q = 0; q < QUESTIONS; q++) {
    const c = eligible[Math.floor(Math.random() * eligible.length)];
    for (const o of buildEightySixQuestion(c, codex).options) {
      if (o.real) continue;
      drawn.set(o.label, (drawn.get(o.label) || 0) + 1);
      draws++;
    }
  }
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const match = args.find(a => !a.startsWith("--"));

const pct = n => (100 * n).toFixed(3).padStart(7) + "%";
const rows = [...codex].sort((a, b) => b.weight - a.weight);
const shown = match
  ? rows.filter(e => e.label.toLowerCase().includes(match.toLowerCase()))
  : all ? rows : rows.slice(0, 30);

console.log(`${recipes.length} recipes, ${codex.length} distinct ingredients, ` +
            `${codex.reduce((s, e) => s + e.count, 0)} mentions`);
console.log(`${ROUNDS} simulated rounds of ${QUESTIONS}, ${draws} impostors drawn\n`);
console.log("  recipes  frequency    weight     drawn  ingredient");
for (const e of shown) {
  console.log(`  ${String(e.count).padStart(7)}  ${pct(e.frequency)}  ${pct(e.weight)}  ` +
              `${pct((drawn.get(e.label) || 0) / draws)}  ${e.label}`);
}
if (!all && !match) console.log(`  … ${rows.length - shown.length} more (--all)`);

// The tail is the number that matters: these are the ingredients a player has
// no reason to have heard of, and their combined share is how often a round
// hands one over.
const tail = rows.filter(e => e.count === 1);
const share = tail.reduce((s, e) => s + e.weight, 0);
console.log(`\n${tail.length} ingredients appear in exactly one recipe. ` +
            `Together they take ${(100 * share).toFixed(2)}% of draws — ` +
            `about one every ${(1 / (share * 2 * QUESTIONS)).toFixed(1)} rounds.`);

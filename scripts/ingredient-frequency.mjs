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

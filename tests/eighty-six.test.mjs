// Run with: npm test
//
// "86 It" draws its wrong answers from the corpus, so the one thing it must
// never do is offer the player a wrong answer that is right. Two names for one
// bottle — Cointreau and Triple Sec — or a name that is a kind of another —
// Whiskey against a Bourbon drink — both mark a knowledgeable player wrong for
// being knowledgeable. Containment catches some of those pairs; the family
// table in src/recipe-meta.js is the rest, and it is a hand-written list, which
// is exactly the kind of thing that rots quietly. So it is pinned here, against
// the real corpus. Plain node, no runner, no dependency.
import { readFileSync } from "node:fs";
import {
  buildLexicon, buildEightySixQuestion, eightySixEligible, drawImpostors,
  ingredientLabels, clashes, INGREDIENT_FAMILIES,
} from "../src/recipe-meta.js";

const { top50, master150 } = JSON.parse(readFileSync(new URL("../src/cocktails.json", import.meta.url), "utf8"));
const ALL = [...top50, ...master150];
const lexicon = buildLexicon(ALL);
const eligible = ALL.filter(eightySixEligible);

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};
const ok = (name, cond) => eq(name, !!cond, true);

// Asked of the rule itself rather than of a draw. A draw removes whatever
// clashes with each name it takes, so a name absent from one is not necessarily
// a name the rule blocked — which would make every "still allows" below pass
// for the wrong reason. The sampler gets its own sweep at the end.
const blocks = (real, gone) => ok(`${real} rules out ${gone}`, clashes(real, gone));
const allows = (real, kept) =>
  ok(`${real} still allows ${kept}`, vocabulary.has(kept) && !clashes(real, kept));

// Ask for more impostors than the lexicon holds and the sampler hands back
// every name it was willing to draw against those ingredients, PRNG spent.
const everyImpostorAgainst = (...real) => drawImpostors(lexicon, real, lexicon.length);

// ── the table describes this corpus ────────────────────────────────────────
// An entry naming an ingredient the book does not use is either a typo or a
// rule that stopped applying when a recipe was edited. Both are invisible from
// the app, and both look exactly like the feature working.
const vocabulary = new Set(lexicon.map(e => e.label));
const entries = Object.entries(INGREDIENT_FAMILIES);
eq("every family name is an ingredient the corpus uses",
  entries.flatMap(([path, names]) => names.filter(n => !vocabulary.has(n)).map(n => `${path}: ${n}`)), []);
eq("no ingredient sits in two families",
  entries.flatMap(([, names]) => names).filter((n, i, a) => a.indexOf(n) !== i), []);

// ── what the report was about ──────────────────────────────────────────────
// The triple secs. Interchangeable enough that a recipe naming one cannot offer
// another as the impostor.
for (const other of ["Triple Sec", "Orange Curaçao", "Grand Marnier", "Orange Liqueur"]) {
  blocks("Cointreau", other);
  blocks(other, "Cointreau");
}
blocks("Orange Curaçao", "Grand Marnier");

// Blue Curaçao is the same liqueur dyed, and is still not in that set: the
// colour is why a drink asks for it, so it stays a wrong answer worth offering.
allows("Cointreau", "Blue Curaçao");
allows("Blue Curaçao", "Orange Curaçao");

// The rums, by colour.
blocks("Dark Rum", "Dark Jamaican Rum");
blocks("Dark Jamaican Rum", "Dark Rum");
blocks("Dark Rum", "Demerara Rum");
blocks("Aged Rum", "Dark Rum");
blocks("White Rum", "Rhum Agricole");
blocks("Rhum Agricole", "White Rum");
blocks("White Rum", "Light Rum");
blocks("Rhum Agricole", "Agricole Rum");
blocks("Dark Jamaican Rum", "Gold Jamaican Rum");   // gold is not dark, but close enough on the shelf

// ── a kind of a thing is the thing ─────────────────────────────────────────
blocks("Bourbon", "Whiskey");
blocks("Whiskey", "Bourbon");
blocks("Canadian Whisky", "Whiskey");     // the other spelling: no shared letters to catch
blocks("Champagne", "Sparkling Wine");
blocks("Cognac", "Brandy");
blocks("Tabasco", "Hot Sauce");
blocks("Amontillado Sherry", "Dry Sherry");
blocks("Guinness", "Beer");
blocks("Clamato Juice", "Tomato Juice");

// ── two names, one line of the recipe ──────────────────────────────────────
blocks("Orange Juice", "OJ");
blocks("Simple Syrup", "Sugar Syrup");
blocks("Tequila Blanco", "Blanco Tequila");
blocks("Apricot Brandy", "Apricot Liqueur");
blocks("Coconut Cream", "Cream of Coconut");
blocks("Chambord", "Raspberry Liqueur");
blocks("Crème de Mûre", "Blackberry Liqueur");
blocks("Calvados", "Applejack");
blocks("Heavy Cream", "Lightly Whipped Cream");
blocks("Heavy Cream", "Half-and-Half");
blocks("St. Germain", "Elderflower Cordial");
blocks("Crème de Cassis", "Blackcurrant Cordial");
blocks("Sweet Vermouth", "Punt e Mes");
blocks("Dry Sherry", "Oloroso Sherry");
blocks("Amontillado Sherry", "Oloroso Sherry");
blocks("Hot Milk", "Whole Milk");
blocks("Boiling Water", "Hot Water");

// A stated alternative is not in the lexicon and so is never an impostor, but
// it is still two real ingredients, and each side has to block its own family.
ok("a recipe reading \"Bourbon or Rye\" exists", eligible.some(c => ingredientLabels(c).includes("Bourbon or Rye")));
blocks("Bourbon or Rye", "Whiskey");
blocks("Applejack or Calvados", "Calvados");

// ── siblings are still each other's best wrong answer ──────────────────────
// The point of the hierarchy. Over-blocking has no symptom the player can see,
// so nothing else would ever catch a family drawn too wide.
allows("Blended Scotch", "Islay Scotch");
allows("Champagne", "Prosecco");
allows("Bourbon", "Rye");
allows("Tequila Blanco", "Reposado Tequila");
allows("Tequila Blanco", "Mezcal");
allows("White Rum", "Dark Rum");
allows("Cointreau", "Maraschino Liqueur");
allows("Heavy Cream", "Whole Milk");
allows("Whole Egg", "Egg White");                  // one is part of the other, not the same line
allows("Sweet Vermouth", "Dry Vermouth");
allows("Dry Vermouth", "Sweet Vermouth");

// ── against the whole book ─────────────────────────────────────────────────
// Every eligible recipe, every impostor the sampler would ever draw for it,
// checked against every one of its real ingredients.
const family = new Map(entries.flatMap(([path, names]) => names.map(n => [n, path])));
const related = (a, b) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
const sameThing = (a, b) => {
  const fa = family.get(a), fb = family.get(b);
  return !!fa && !!fb && related(fa, fb);
};
const offences = [];
for (const c of eligible) {
  const real = ingredientLabels(c);
  for (const impostor of everyImpostorAgainst(...real)) {
    for (const r of real) if (sameThing(impostor, r)) offences.push(`${c.name}: ${impostor} / ${r}`);
  }
}
eq("no recipe can be offered its own ingredient under another name", offences.slice(0, 10), []);

// And the quiz still has questions to ask.
eq("every eligible recipe still has impostors to draw",
  eligible.filter(c => everyImpostorAgainst(...ingredientLabels(c)).length < 20).map(c => c.name), []);
ok("a question is real ingredients plus one to three impostors", eligible.every(c => {
  const q = buildEightySixQuestion(c, lexicon);
  const impostors = q.options.filter(o => !o.real).length;
  return q.options.filter(o => o.real).length === ingredientLabels(c).length
    && impostors >= 1 && impostors <= 3;
}));

console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);

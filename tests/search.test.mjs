// Run with: npm test
//
// The index's search reads a query against the ingredient vocabulary rather
// than against the recipe text (see the search section of src/recipe-meta.js),
// and every rule in it is a judgement call about a real query someone typed:
// "rum, lime" is two ingredients, "lime juice" is one, "gin" is not Ginger
// Beer. None of that is visible from the code being green, so it is pinned
// here, against the real corpus. Plain node, no runner, no dependency.
import { readFileSync } from "node:fs";
import { buildSearchIndex, searchCards, parseSearchQuery, ingredientLabels, getMethod, norm } from "../src/recipe-meta.js";

const { top50, master150 } = JSON.parse(readFileSync(new URL("../src/cocktails.json", import.meta.url), "utf8"));
const ALL = [...top50, ...master150];
const index = buildSearchIndex(ALL);

const find = q => searchCards(index, q).map(c => c.name);
const reading = q => parseSearchQuery(q, index).map(t => t.words.join(" "));

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};
const ok = (name, cond) => eq(name, !!cond, true);
const finds = (q, drink) => ok(`"${q}" finds ${drink}`, find(q).includes(drink));
const misses = (q, drink) => ok(`"${q}" does not find ${drink}`, !find(q).includes(drink));

// ── how a query comes apart ────────────────────────────────────────────────
// The vocabulary decides: "simple syrup" is an ingredient, "rum lime" is not.
eq("two ingredients, comma", reading("rum, lime"), ["rum", "lime"]);
eq("two ingredients, no comma", reading("rum lime"), ["rum", "lime"]);
eq("lime juice is one ingredient", reading("lime juice"), ["lime juice"]);
eq("simple syrup is one ingredient", reading("simple syrup"), ["simple syrup"]);
eq("longest phrase wins, then the rest", reading("rum simple syrup"), ["rum", "simple syrup"]);
eq("nothing to search on", reading("   "), []);

// ── "rum, lime" ────────────────────────────────────────────────────────────
// The report that opened this: a search naming two ingredients returned
// nothing, because no recipe contains the string "rum, lime".
ok("a two-ingredient search has answers", find("rum, lime").length > 0);
eq("the comma is optional", find("rum lime"), find("rum, lime"));
eq("case is not a filter", find("RUM, LIME"), find("rum, lime"));
eq("nor is spacing", find("  rum   lime "), find("rum, lime"));
ok("every answer carries both",
  searchCards(index, "rum, lime").every(c => /\brum\b/i.test(c.ingredients) && /\blime\b/i.test(norm(c.ingredients))));
ok("both are required, so it is narrower than either",
  find("rum, lime").length < find("rum").length && find("rum, lime").length < find("lime").length);
finds("rum, lime", "Daiquiri");
misses("rum, lime", "Negroni");

// ── a compound ingredient is not its words ─────────────────────────────────
// "lime juice" is an ingredient. The Whiskey Sour has juice and the Penicillin
// has syrup, and neither is an answer to it.
finds("lime juice", "Daiquiri");
misses("lime juice", "Whiskey Sour");
ok("every lime juice answer really has lime juice",
  searchCards(index, "lime juice").every(c => c.ingredients.split(",").some(p => /lime\s+juice/i.test(p))));
finds("simple syrup", "Whiskey Sour");
misses("simple syrup", "Penicillin");     // honey-ginger syrup is a different syrup

// ── a bare word is the whole family ────────────────────────────────────────
// "syrup" and "juice" name no single ingredient, so they name all of them.
finds("juice", "Daiquiri");               // lime
finds("juice", "Whiskey Sour");           // lemon
finds("syrup", "Whiskey Sour");           // simple
finds("syrup", "Penicillin");             // honey-ginger
ok("a family contains its members",
  find("simple syrup").every(n => find("syrup").includes(n)));
ok("and is bigger than any one of them", find("syrup").length > find("simple syrup").length);

// ── rum, the same question from the other end ──────────────────────────────
finds("rum", "Daiquiri");                 // white
finds("rum", "Mai Tai");                  // dark
ok("every rum is a rum", find("jamaican rum").every(n => find("rum").includes(n)));
ok("but not every rum is Jamaican", find("jamaican rum").length < find("rum").length);
misses("jamaican rum", "Daiquiri");

// ── a word is a word, not a fragment ───────────────────────────────────────
// The old substring test could not tell gin from ginger, or from Virgin.
finds("gin", "Negroni");
misses("gin", "Moscow Mule");             // ginger beer
misses("gin", "Virgin Mary");             // no alcohol at all
finds("ginger", "Moscow Mule");
misses("ginger", "Negroni");

// ── the word still being typed ─────────────────────────────────────────────
// "ru" is no ingredient, so it is read as a prefix: every rum, and every drink
// whose name starts a word with it. The White Russian riding along on its name
// is the price of a list that narrows as you type — and it is gone the moment
// the word is finished. A word the vocabulary knows in full is never read this
// way, which is the whole gin/ginger rule above.
ok("a half-typed word keeps everything the finished one finds",
  find("rum").every(n => find("ru").includes(n)));
finds("ru", "Daiquiri");                  // rum, by ingredient
finds("ru", "White Russian");             // vodka, Kahlúa and cream — by name alone
finds("ru", "Rusty Nail");
misses("rum", "White Russian");           // finished word, and the Russians drop out
ok("finishing the word is narrower", find("rum").length < find("ru").length);
ok("half-typed reaches the ingredient too",
  find("syrup").every(n => find("syr").includes(n)));

// ── searching by name ──────────────────────────────────────────────────────
// A name is read as far as it is typed — the drink has to show up before the
// last letter of it does.
finds("negro", "Negroni");
finds("pina", "Piña Colada");             // accents fold both ways
finds("piña", "Piña Colada");
finds("pina cola", "Piña Colada");        // "cola" is an ingredient; still the drink
finds("old fash", "Old Fashioned");
finds("aperol s", "Aperol Spritz");
finds("pimms", "Pimm's Cup");             // the apostrophe is not a word break
finds("pimm's", "Pimm's Cup");
eq("an empty search is the whole book", find("").length, ALL.length);
eq("so is one with no words in it", find("?!").length, ALL.length);
eq("a search for nothing that exists", find("xyzzy"), []);

// ── how the drink is made ──────────────────────────────────────────────────
// The method and the serve style are searchable too: what someone wants when
// they type "swizzled" is the swizzles, and no ingredient line says so.
const swizzles = ALL.filter(c => /Swizzled/.test(getMethod(c))).map(c => c.name);
eq("swizzled is every swizzle", find("swizzled"), swizzles);
ok("half-typed still gets there", swizzles.every(n => find("swizz").includes(n)));
finds("swizzled", "Queen's Park Swizzle");
finds("swizzled", "Ti' Punch");           // a swizzle that does not say so in its name

// A swizzle is built in the glass, so it answers to both halves of "Built,
// Swizzled" — the prose adjective picks one word, the search keeps both.
finds("built", "Bermuda Rum Swizzle");
finds("built", "Old Fashioned");

// "Built, Not Stirred" is the method that exists to say a drink is NOT stirred.
misses("stirred", "Champagne Cocktail");
misses("stirred", "Kir Royale");
finds("built", "Champagne Cocktail");
misses("shaken", "Negroni");              // stirred, and no tin comes near it

// Crushed ice is a technique the ingredient line does not record — getMethod
// reads `serve` and then calls the drink Built, Stirred like any other.
const crushed = ALL.filter(c => c.serve === "Over Crushed Ice").map(c => c.name);
eq("crushed is every drink served on it", find("crushed"), crushed);
finds("crushed", "Mint Julep");
finds("crushed", "Mojito");
ok("more than the one recipe that writes it into its ingredients", find("crushed").length > 1);

// Frozen is a serve style AND a method: every frozen drink came out of a
// blender, which is what getMethod already makes of it.
finds("frozen", "Frozen Margarita");
finds("frozen", "Miami Vice");
ok("and every frozen drink is a blended one", find("frozen").every(n => find("blended").includes(n)));

// The techniques inference cannot see, carried by an explicit method.
finds("rolled", "Bloody Mary");           // tomato juice, neither shaken nor stirred
finds("flash blend", "Zombie");
finds("thrown", "Blue Blazer");
finds("layered", "B-52");

// A method term is ANDed with the rest like any other, so it narrows.
ok("a method plus an ingredient is narrower than the method",
  find("swizzled rum").length < find("swizzled").length);
ok("and every answer is still a swizzle",
  find("swizzled rum").every(n => find("swizzled").includes(n)));
finds("swizzled rum", "Bermuda Rum Swizzle");
misses("swizzled rum", "Chartreuse Swizzle");

// ── corpus-wide properties ─────────────────────────────────────────────────
// Two guards that hold for all 322 recipes, so a rule change cannot quietly
// lose a drink: every ingredient name finds every recipe carrying it, and every
// drink is reachable from every prefix of its own name.
const unfindableByIngredient = [];
for (const c of ALL) {
  for (const label of ingredientLabels(c)) {
    if (!find(label).includes(c.name)) unfindableByIngredient.push(`${c.name} :: ${label}`);
  }
}
eq("every ingredient finds the drinks that use it", unfindableByIngredient, []);

const unfindableByName = [];
for (const c of ALL) {
  const name = norm(c.name).replace(/['’]/g, "");
  for (let i = 1; i <= name.length; i++) {
    const typed = name.slice(0, i);
    if (/[a-z0-9]$/.test(typed) && !find(typed).includes(c.name)) unfindableByName.push(`${c.name} @ "${typed}"`);
  }
}
eq("every drink is findable from every prefix of its name", unfindableByName, []);

const unfindableByMethod = [];
for (const c of ALL) {
  // The first segment of the method, which is the word someone would type:
  // "Built, Swizzled" is looked up as "built", "Flash Blend" as itself.
  const word = getMethod(c).split(",")[0].trim().toLowerCase();
  if (!find(word).includes(c.name)) unfindableByMethod.push(`${c.name} :: ${word}`);
}
eq("every drink answers to its own method", unfindableByMethod, []);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

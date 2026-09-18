// The corpus: one definition of "the list of cocktails", and the counts that
// come off it.
//
// This lived in four places — App.jsx, vite.config.js, the frequency script and
// the tests each read cocktails.json and concatenated its two halves — and four
// definitions is how a count goes wrong. The numbers in the app were right
// because they were `.length` over a real list; the ones nobody could compute
// were typed by hand and drifted, so index.html's structured data still told
// crawlers about 322 recipes and the store listing offered "270+" of a set of
// 284.
//
// So: counting is a function over a list, never a literal. The lists have names
// because reaching for the wrong one is the other half of the same bug — 86 It's
// "All Cocktails" button counted the pool when the quiz runs the quizzable pool,
// and advertised one more question than it asked.
//
// The import attribute is what lets one module serve both sides: Node requires
// `with { type: "json" }` for a JSON module, and Vite accepts it.
import cocktails from "./cocktails.json" with { type: "json" };
import { eightySixEligible } from "./recipe-meta.js";

// The free tier's cocktails, in rank order, and the rest. `master150` is
// historical — the name says 150 and the list holds 284 — but it is a key in
// stored JSON, so it is renamed here rather than there.
export const FREE_CARDS = cocktails.top50;
export const PRO_CARDS = cocktails.master150;

// Every cocktail in the book.
export const ALL_CARDS = [...FREE_CARDS, ...PRO_CARDS];

// Count a list of cocktails. Trivial on purpose: the value is that every number
// the app or the build states about the book is counted off a real list, so
// adding a recipe to cocktails.json moves every one of them at once.
export function countCocktails(cards) {
  return (cards || []).length;
}

// The subset of a list that 86 It can ask about: a question needs at least two
// ingredients. Every recipe currently clears that, so this returns the list it
// was given — which is the reason to call it rather than assume. A recipe whose
// ingredients are prose would drop out here and nowhere else, and the button
// that advertises how many questions a round holds would follow it down.
export function quizzableCocktails(cards) {
  return (cards || []).filter(eightySixEligible);
}

// The high-water merge: the one rule that progress only ever grows.
//
// Shared by both halves. The client raises each account's mark with this on
// every save (App.jsx -> saveHighWater); the server merges the same mark into
// users/{uid} on a restore (netlify/functions/admin-restore.mjs), through the
// re-export in netlify/functions/_backup.mjs. One implementation, run on both
// sides, kept free of any import so it can live in the browser bundle.

export const DEFAULT_DECK_SIZE = 20;

const asArray = (v) => (Array.isArray(v) ? v : []);
// Sorted, so the result depends only on WHAT the two sides hold and not on which
// of them was merged first. Without it two devices raising the same mark from
// different states produce documents that differ only in array order — equal in
// content, unequal to any comparison — and each then sees the other's write as a
// change worth answering. Order carries no meaning in any of these lists: the
// deck is re-ordered by refillDeck() on the next load anyway.
const union = (a, b) => Array.from(new Set([...asArray(a), ...asArray(b)])).sort();

// Merge two progress states, keeping the best of each: the higher score per
// cocktail, the union of every list. Commutative, associative and idempotent —
// a least-upper-bound, which is what lets it be applied repeatedly, in any
// order, from any device, and always land in the same place. Everything else
// here depends on that: it is why a high-water mark cannot be walked backwards
// by an out-of-order write, and why a restore can be re-run without thinking.
//
// The same rule App.jsx -> mergeStates() applies when it folds a device's
// progress into an account, for the same reason: having mastered a cocktail is a
// fact that no other copy of the data can un-know.
//
// `active` is the one thing that may shrink, because a mastered cocktail leaves
// the deck. It is otherwise the union, left untrimmed: only the client knows
// which cocktails the pool currently covers — the free top 50, or the whole book
// with Pro — and its refillDeck() cuts the deck back to size on the next load.
// Trimming here would mean guessing, and guessing low loses a card someone was
// studying.
export function mergeProgress(a, b, uid) {
  if (!a && !b) return null;

  const scores = { ...(a?.scores || {}) };
  for (const [name, value] of Object.entries(b?.scores || {})) {
    scores[name] = Math.max(Number(scores[name]) || 0, Number(value) || 0);
  }

  const learned = union(a?.learned, b?.learned);
  const learnedSet = new Set(learned);

  const merged = {
    scores,
    learned,
    tried: union(a?.tried, b?.tried),
    active: union(a?.active, b?.active).filter((n) => !learnedSet.has(n)),
    masterMode: Boolean(a?.masterMode || b?.masterMode),
    // A current preference rather than progress, so a live value wins and the
    // other side only supplies one where there is none.
    deckSize: a?.deckSize || b?.deckSize || DEFAULT_DECK_SIZE,
  };
  if (uid) merged.uid = uid;
  return merged;
}

// True when two states hold exactly the same progress, whatever order their
// lists happen to be in. Used to skip a write that would say nothing.
export function sameProgress(a, b) {
  return growsFrom(a, b) && growsFrom(b, a);
}

// True when `next` holds everything `prev` did. The high-water rules in
// firestore.rules enforce exactly this server-side; checking it here too means a
// write that would be rejected is never sent, and a bug that would lose progress
// shows up in the console rather than as a silent permission error.
export function growsFrom(prev, next) {
  if (!prev) return true;
  if (!next) return false;
  const has = (before, after) => {
    const s = new Set(asArray(after));
    return asArray(before).every((v) => s.has(v));
  };
  return (
    has(prev.learned, next.learned) &&
    has(prev.tried, next.tried) &&
    has(Object.keys(prev.scores || {}), Object.keys(next.scores || {})) &&
    (!prev.masterMode || Boolean(next.masterMode))
  );
}

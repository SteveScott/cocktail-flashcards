// Derivations over cocktails.json, shared by the React app and the build-time
// static page generator (scripts/seo-pages.mjs).
//
// It lives in src/ and is deliberately free of React, DOM and Node APIs: the
// generator imports it from a Node process at build time, App.jsx imports it
// into the bundle. One copy means a recipe page can never state a different
// method or glass than the flashcard for the same drink — a mismatch Google
// would read as exactly the kind of low-quality generated content that gets a
// site rejected.

// Fold text to lowercase ASCII so accented characters match their plain form
// (e.g. "piña" and "pina", "crème" and "creme") in search.
export function norm(s) {
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// URL slug for a recipe page. Built from the normalized name so "Piña Colada"
// and "Crème de Menthe" produce clean ASCII paths.
export function slugify(name) {
  return norm(name).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const BUILT_GLASSES = /highball|collins|copper mug|pint|wine|sling|zombie/;
const BUILT_MIXERS = /soda water|tonic|ginger beer|coca-cola|\bcola\b|tomato juice|clamato|beer|champagne|prosecco|tequila blanco|grapefruit soda|lemonade/;

// Anything that must be shaken to emulsify or aerate: citrus, egg, dairy,
// purée, or espresso.
const SHAKE_TRIGGERS = /fresh (lime|lemon|grapefruit|orange|pineapple) juice|(lime|lemon|grapefruit|orange|pineapple|cranberry|tomato|passion ?fruit) juice|sour mix|egg white|egg\b|heavy cream|cream of coconut|coconut cream|purée|puree|half-and-half|espresso/;

// Shaken / Stirred / Built / Blended / Layered, inferred from the recipe.
//
// This was moved out of App.jsx, and the shake rule was tightened on the way.
// The old version shook anything containing a syrup, which mislabelled 13
// all-spirit classics — a Sazerac, both Old Fashioned variants, the Toronto,
// the Japanese Cocktail. The real bar rule is what's encoded now: shake only
// for citrus, egg, dairy, purée or espresso; stir anything spirit-and-sugar.
// Drinks served on crushed ice (julep, cobbler, frappé) are built in the glass.
export function getMethod(c) {
  const name = c.name.toLowerCase();
  const ing = c.ingredients.toLowerCase();
  const glass = (c.glass || "").toLowerCase();

  if (/blend|frozen/.test(name) || /blend(?!ed scotch)/.test(ing)) return "Blended";
  if (/layered/.test(ing)) return "Layered";
  if (BUILT_GLASSES.test(glass) && BUILT_MIXERS.test(ing)) return "Built";
  if (SHAKE_TRIGGERS.test(ing)) return "Shaken";
  if (/crushed ice/.test(ing)) return "Built";
  return "Stirred";
}

// Split on commas that are NOT inside parentheses. Three recipes carry a
// parenthetical containing its own comma ("Coffee Liqueur (Kahlúa, or Tia
// Maria)"), and a naive split shears them in half.
function splitParts(str) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

// A component is "measured" when it opens with a quantity — a digit or a
// vulgar fraction. Everything else is a garnish, rinse, or topper.
const MEASURE_RE = /^((?:[\d½¼¾⅓⅔⅛⅜⅝⅞]+(?:[-–][\d½¼¾⅓⅔⅛⅜⅝⅞]+)?\s*(?:oz|dash(?:es)?|drops?|tsp|tbsp|cups?|scoops?|barspoons?|barspoon)?|(?:pinch|splash|dash|shot|handful) of)\s*)\s*(.*)$/i;
const GARNISH_RE = /garnish|peel|twist|sprig|wedge|wheel|slice|cherry|olive|rinse|zest|rim|dusting|grated|flamed|expressed|skewer|umbrella|nutmeg$/i;

// Parse the ingredient string into structured components plus garnishes.
export function parseIngredients(str) {
  const components = [];
  const garnishes = [];
  for (const part of splitParts(str || "")) {
    const m = part.match(MEASURE_RE);
    if (m && !/\(garnish\)/i.test(part)) {
      components.push({ measure: m[1].trim(), item: m[2].trim(), text: part });
    } else if (GARNISH_RE.test(part) || !m) {
      garnishes.push(part.replace(/\s*\(garnish\)\s*/i, "").trim());
    } else {
      components.push({ measure: m[1].trim(), item: m[2].trim(), text: part });
    }
  }
  return { components, garnishes };
}

const SPIRITS = [
  [/\bmezcal\b/i, "Mezcal"],
  [/\btequila\b/i, "Tequila"],
  [/\b(rye|bourbon|scotch|irish whiskey|whisk(e)?y)\b/i, "Whiskey"],
  [/\b(cachaça|cachaca)\b/i, "Cachaça"],
  [/\b(rum|rhum)\b/i, "Rum"],
  [/\bgin\b/i, "Gin"],
  [/\bvodka\b/i, "Vodka"],
  [/\b(cognac|brandy|armagnac|pisco|calvados)\b/i, "Brandy"],
  [/\b(sherry|port|vermouth|aperitif|campari|aperol|lillet|dubonnet)\b/i, "Fortified Wine & Aperitifs"],
  [/\b(champagne|prosecco|cava|rosé|rose wine|wine)\b/i, "Sparkling & Wine"],
  [/\b(absinthe|chartreuse|pastis|sambuca)\b/i, "Absinthe & Herbal"],
  [/\b(fernet|amaro|jägermeister|jagermeister|pimm's|pimms|licor 43|galliano)\b/i, "Amaro & Bitters"],
  [/\b(beer|lager|stout|cider)\b/i, "Beer & Cider"],
  [/\bno alcohol\b/i, "Non-Alcoholic"],
  [/\b(liqueur|schnapps|curaçao|curacao|crème de|creme de|midori|amaretto|kahlúa|kahlua|baileys)\b/i, "Liqueur"],
];

// The drink's base category, used to group recipes and to cross-link related
// ones. Reads the FIRST measured component first — in a well-written recipe
// that is the base — and only falls back to scanning the whole line.
export function baseSpirit(c) {
  const { components } = parseIngredients(c.ingredients);
  const lead = components[0]?.item || "";
  for (const [re, label] of SPIRITS) if (re.test(lead)) return label;
  for (const [re, label] of SPIRITS) if (re.test(c.ingredients)) return label;
  return "Other";
}

function glassPhrase(glass) {
  const g = (glass || "").trim();
  if (!g) return "a chilled glass";
  // "Coupe or Martini" → "a coupe or martini glass"; don't append "glass" to
  // things that already name the vessel.
  const needsGlass = !/glass|mug|flute|tin|cup|shot/i.test(g);
  return `a ${g.toLowerCase()}${needsGlass ? " glass" : ""}`;
}

// Step-by-step build instructions, composed from the method, glassware and
// garnish. This is the part of a recipe page that is genuinely useful to a
// reader and absent from the raw data — the flashcards teach the ingredient
// list, these pages teach the execution.
export function buildSteps(c) {
  const method = getMethod(c);
  const { components, garnishes } = parseIngredients(c.ingredients);
  const list = components.map(x => x.text).join(", ");
  const glass = glassPhrase(c.glass);
  const steps = [];

  if (method === "Shaken") {
    steps.push(`Add ${list} to a cocktail shaker.`);
    if (/egg white/i.test(c.ingredients)) {
      steps.push("Dry-shake without ice for about 10 seconds to emulsify the egg white and build foam.");
    }
    steps.push("Fill the shaker with ice and shake hard for 10–12 seconds, until the tin is frosted and well chilled.");
    steps.push(`Double-strain into ${glass}.`);
  } else if (method === "Stirred") {
    steps.push(`Add ${list} to a mixing glass.`);
    steps.push("Fill with ice and stir for 20–30 seconds, until well chilled and properly diluted.");
    steps.push(`Strain into ${glass}.`);
  } else if (method === "Built") {
    steps.push(`Fill ${glass} with fresh ice.`);
    steps.push(`Add ${list} directly to the glass, in order.`);
    steps.push("Stir gently once or twice to combine without knocking out the carbonation.");
  } else if (method === "Blended") {
    steps.push(`Add ${list} to a blender along with about a cup of crushed ice.`);
    steps.push("Blend on high until completely smooth, with no ice shards left.");
    steps.push(`Pour into ${glass}.`);
  } else {
    steps.push(`Pour ${list} slowly over the back of a bar spoon, in the order listed.`);
    steps.push(`Take care to keep each layer distinct in ${glass}.`);
  }

  if (garnishes.length) {
    steps.push(`Garnish with ${garnishes.join(", ").toLowerCase()}.`);
  }
  return steps;
}

// One-line summary used as the page's meta description and its opening line.
export function summarize(c) {
  const method = getMethod(c).toLowerCase();
  const { components } = parseIngredients(c.ingredients);
  const named = components.slice(0, 3).map(x => x.item.replace(/\s*\([^)]*\)/g, "")).join(", ");
  return `A ${method} cocktail made with ${named}, served in ${glassPhrase(c.glass)}.`;
}

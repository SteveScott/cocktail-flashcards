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
const BUILT_MIXERS = /\bsoda\b|tonic|ginger beer|ginger ale|coca-cola|\bcola\b|tomato juice|clamato|beer|champagne|prosecco|tequila blanco|lemonade/;

// Anything that must be shaken to emulsify or aerate: citrus, egg, dairy,
// purée, or espresso.
// Which mixers actually carry bubbles. Narrower than BUILT_MIXERS, which
// includes tequila blanco so that a Ranch Water reads as a build — true of the
// method, but there is no carbonation in the tequila to protect.
const CARBONATED = /\bsoda\b|tonic|ginger beer|ginger ale|coca-cola|\bcola\b|sparkling|seltzer|topo chico|beer|stout|champagne|prosecco|lemonade|cider/i;

const SHAKE_TRIGGERS = /fresh (lime|lemon|grapefruit|orange|pineapple) juice|(lime|lemon|grapefruit|orange|pineapple|cranberry|tomato|passion ?fruit) juice|sour mix|egg white|egg\b|heavy cream|cream of coconut|coconut cream|purée|puree|half-and-half|espresso/;

// A sour base: citrus AND a sweetener. This is the pair that has to be shaken
// to marry, and it is what separates a Tom Collins from a Gin Rickey. Both are
// gin, citrus and soda in a collins glass; only the Collins carries the syrup,
// and only the Collins is shaken and then topped.
const CITRUS = /(lime|lemon|grapefruit|orange|pineapple) juice/;
const SWEETENER = /syrup|sugar|honey|orgeat|grenadine|agave nectar|cordial|falernum/;
// Emulsifiers shake on their own account, with or without citrus — a Colorado
// Bulldog is cream and cola and still belongs in a tin.
const EMULSIFIER = /egg white|egg\b|heavy cream|\bcream\b|cream of coconut|coconut cream|purée|puree|half-and-half|espresso/;
// A tomato base is rolled, not stirred and not shaken: shaking froths it and
// bruises the seasoning, stirring in the glass never mixes it.
const ROLLED_BASE = /tomato juice|clamato/;

// Leaf herbs are always pressed before the drink is mixed — the oils are the
// reason they are in the glass, and they do not come out on their own. This
// tests a parsed ingredient, never the raw string, so a mint sprig sitting in
// the garnish bucket (a Moscow Mule, a Pimm's Cup) is left alone.
const HERBS = /\b(mint|basil)\b/i;

// Shaken / Stirred / Built / Blended / Layered, inferred from the recipe, or
// taken verbatim from an explicit `method` on the recipe itself. Overrides may
// also name a technique the inference has no rule for at all: Flash Blend,
// Thrown, Heated, Dropped, Chased. See docs/methods.md for the sourced list.
//
// The escape hatch exists because inference can only see the ingredient list,
// and some techniques leave no trace in it. The tiki flash blend is the case
// in point: the Zombie's five-second whip with crushed ice is part of the
// recipe as Donn Beach wrote it, but nothing in "rum, lime, falernum" implies
// it, and every rule below would call the drink Shaken.
//
// This was moved out of App.jsx, and the shake rule was tightened on the way.
// The old version shook anything containing a syrup, which mislabelled 13
// all-spirit classics — a Sazerac, both Old Fashioned variants, the Toronto,
// the Japanese Cocktail. The real bar rule is what's encoded now: shake only
// for citrus, egg, dairy, purée or espresso; stir anything spirit-and-sugar.
// Drinks served on crushed ice (julep, cobbler, frappé) are built in the glass.
//
// The blend rule matches the technique as the data writes it ("blended with",
// "(blended)") rather than the bare word, which used to collide with spirits
// whose names contain it — a Test Pilot's Blended Aged Rum and a Seven & Seven's
// Blended Whiskey were both being sent to a blender.
export function getMethod(c) {
  if (c.method) return c.method;

  const name = c.name.toLowerCase();
  const ing = c.ingredients.toLowerCase();
  const glass = (c.glass || "").toLowerCase();

  if (/blend|frozen/.test(name) || /blended with|\(blended\)/.test(ing)) return "Blended";
  if (/layered/.test(ing)) return "Layered";
  if (ROLLED_BASE.test(ing)) return "Rolled";
  // Crushed ice is settled at the bottom of this function, not here: a Mai Tai
  // and a Hurricane are shaken and then poured over it. But it does exempt a
  // drink from the two sour rules below, which would otherwise send a Mojito
  // and a Caipirinha — citrus and sugar both — to a tin they never see.
  const crushed = /crushed ice/.test(ing) || c.serve === "over crushed ice";
  // Before the build rule, not after it. A fizz, a collins and a Long Island
  // are all sours that happen to be finished with soda in a tall glass, and
  // testing the glass first called every one of them a build — which left a
  // Ramos Gin Fizz, raw egg white and cream, being stirred in the glass.
  if (!crushed && CITRUS.test(ing) && SWEETENER.test(ing)) return "Shaken";
  if (!crushed && EMULSIFIER.test(ing)) return "Shaken";
  if (BUILT_GLASSES.test(glass) && BUILT_MIXERS.test(ing)) return "Built, Stirred";
  if (SHAKE_TRIGGERS.test(ing)) return "Shaken";
  if (crushed) return "Built, Stirred";
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
// vulgar fraction. Everything else is a garnish, rinse, or topper. The "of"
// after a pinch or a dash is optional because the data writes it both ways:
// "Dash of Cognac" and "Dash Cognac" are the same ingredient, and only the
// first was being counted as one.
const MEASURE_RE = /^((?:[\d½¼¾⅓⅔⅛⅜⅝⅞]+(?:[-–][\d½¼¾⅓⅔⅛⅜⅝⅞]+)?\s*(?:oz|dash(?:es)?|drops?|tsp|tbsp|cups?|scoops?|shots?|barspoons?|barspoon)?|(?:pinch|splash|dash|shot|handful)(?: of)?)\s*)\s*(.*)$/i;
const GARNISH_RE = /garnish|peel|twist|sprig|wedge|wheel|slice|cherry|olive|rinse|zest|rim|dusting|grated|flamed|expressed|skewer|umbrella|nutmeg$/i;

// A trailing "(top)" marks a modifier poured over the finished drink — the soda
// in a Mojito, the Champagne in a Champagne Cocktail. It carries no measure, so
// it used to fall through to the garnish bucket and drop out of the build
// entirely, which left the Champagne Cocktail with nothing in it but sugar and
// bitters. Floats stay garnishes on purpose: an Irish Coffee's cream goes on
// after the drink is made, not into it.
const TOPPER_RE = /\((?:top|topped|top up)\)\s*$/i;

// A float, a splash and a rinse are amounts of liquid, no different from an
// ounce — the data just writes the unit after the ingredient instead of before
// it. "Dark Rum float" is a measure of dark rum, and reading it as unmeasured
// is what dropped a Mai Tai's float into the garnish line.
const TRAILING_MEASURE_RE = /^(.*?)[\s(]+(float|drizzle|splash|rinse)\)?\s*$/i;

// Build order. Where a recipe does not dictate its own sequence, ingredients go
// in liquor, citrus, syrup, juice order, with dashes, floats and splashes last.
//
// Carbonated things rank last whatever their volume: a Moscow Mule's four
// ounces of ginger beer is still the thing that goes in on top.
const ORDER_TOPPER = /\b(soda|seltzer|sparkling|tonic|ginger beer|ginger ale|cola|coca-cola|lemon-lime|lemonade|energy drink|champagne|prosecco|cava|topo chico|beer|lager|stout|cider)\b/i;
const ORDER_LIQUOR = /\b(gin|vodka|rum|rhum|whisk(e)?y|rye|bourbon|scotch|tequila|mezcal|cachaça|cognac|brandy|armagnac|calvados|pisco|applejack|aquavit|absinthe|chartreuse|campari|aperol|suze|cynar|amaro|averna|fernet|bénédictine|drambuie|galliano|amaretto|kahlúa|baileys|curaçao|cointreau|triple sec|maraschino|liqueur|crème de|creme de|vermouth|sherry|port|lillet|dubonnet|punt e mes|pimm's|wine|sake|jägermeister|passoa|midori|chambord|st-germain|st\. germain|falernum|allspice dram|pastis|sambuca|schnapps|licor 43|heering|arrack|grappa|limoncello|advocaat|sloe gin|old tom|genever|overproof|southern comfort|151)\b/i;
const ORDER_CITRUS = /\b(lime|lemon|grapefruit|orange)\b[^,]*\bjuice\b/i;
const ORDER_SYRUP  = /\b(syrup|orgeat|grenadine|honey|agave|sugar|cane|gomme|nectar|cordial)\b/i;

function buildRank(x) {
  const measure = (x.measure || "").toLowerCase();
  const item = x.item || "";
  if (x.role === "float" || x.role === "rinse") return 4;
  if (/^(top|splash|float|drizzle|rinse)$/.test(measure) || /dash|drop/.test(measure)) return 4;
  if (ORDER_TOPPER.test(item)) return 4;
  if (ORDER_LIQUOR.test(item)) return 0;
  if (ORDER_CITRUS.test(item)) return 1;
  if (ORDER_SYRUP.test(item)) return 2;
  return 3; // juice, and anything the ranks cannot name — dairy, egg, mint
}

// The same ordering applied to a raw ingredient string, so the recipe as written
// and the steps generated from it agree. Garnishes hold their relative order at
// the end.
export function canonicalIngredientOrder(str) {
  const parts = splitParts(str || "");
  const byText = new Map(parseIngredients(str).components.map(x => [x.text, x]));
  return parts
    .map((text, i) => ({ text, i, rank: byText.has(text) ? buildRank(byText.get(text)) : 9 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(x => x.text)
    .join(", ");
}

// Stable, so ingredients the ranking cannot separate keep the order the recipe
// wrote them in.
function inBuildOrder(components) {
  return components
    .map((x, i) => [x, i])
    .sort((a, b) => buildRank(a[0]) - buildRank(b[0]) || a[1] - b[1])
    .map(([x]) => x);
}

// Where a component goes in the sequence. A float lands on the finished drink
// and a rinse coats the glass before anything else, so neither is poured in
// with the body of the drink — but both are ingredients.
function roleOf(text) {
  if (/[\s(](?:float|drizzle)\)?\s*$/i.test(text)) return "float";
  if (/[\s(]rinse\)?\s*$/i.test(text)) return "rinse";
  return null;
}

// Strip the trailing unit, so "¼ oz Islay Scotch (float)" reads as "¼ oz Islay
// Scotch" once the step itself says to float it.
export function stripTrailingUnit(text) {
  return text.replace(/[\s(]+(?:float|drizzle|splash|rinse)\)?\s*$/i, "").trim();
}

// Parse the ingredient string into structured components plus garnishes.
export function parseIngredients(str) {
  const components = [];
  const garnishes = [];
  for (const part of splitParts(str || "")) {
    const m = part.match(MEASURE_RE);
    if (m && !/\(garnish\)/i.test(part)) {
      components.push({ measure: m[1].trim(), item: m[2].trim(), text: part });
    } else if (!m && TOPPER_RE.test(part)) {
      components.push({ measure: "Top", item: part.replace(TOPPER_RE, "").trim(), text: part });
    } else if (!m && TRAILING_MEASURE_RE.test(part)) {
      const t = part.match(TRAILING_MEASURE_RE);
      const unit = t[2][0].toUpperCase() + t[2].slice(1).toLowerCase();
      components.push({ measure: unit, item: t[1].trim(), text: part });
    } else if (GARNISH_RE.test(part) || !m) {
      garnishes.push(part.replace(/\s*\(garnish\)\s*/i, "").trim());
    } else {
      components.push({ measure: m[1].trim(), item: m[2].trim(), text: part });
    }
  }
  return { components: components.map(x => ({ ...x, role: roleOf(x.text) })), garnishes };
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

// The method names double as adjectives in prose ("a shaken cocktail", "a
// stirred cocktail"). Most are already participles; these are not. Both builds
// flatten back to "built" here — the stirred/not-stirred split is a fact about
// the last step, and "a built, not stirred cocktail" is not a sentence.
const METHOD_ADJECTIVE = {
  "Flash Blend": "flash-blended",
  "Dropped": "bomb-style",
  "Built, Stirred": "built",
  "Built, Not Stirred": "built",
  "Built, Swizzled": "swizzled",
};

function methodAdjective(method) {
  return METHOD_ADJECTIVE[method] || method.toLowerCase();
}

// Where the finished drink lands. The serve style is the fact that says whether
// there is ice in the glass and what kind — glassware never said it: a Sazerac
// and an Old Fashioned are both rocks glasses, and only one of them has ice in
// it. Up is chilled and iceless; neat is iceless and never chilled at all.
function serveTarget(c, glass) {
  switch (c.serve) {
    case "on the rocks":     return `${glass} filled with fresh ice`;
    case "over crushed ice": return `${glass} packed with crushed ice`;
    case "up":               return `a chilled ${glass.replace(/^an? /, "")}`;
    default:                 return glass;
  }
}

// "6-8 Fresh Mint Leaves" reads as "the mint" in an instruction, not as its
// measure over again. Falls back to "leaves" for a herb the test picks up but
// this does not name.
function herbNoun(herbs) {
  const names = [...new Set(herbs.map(x => (x.item.match(HERBS) || [])[1]).filter(Boolean))];
  return names.length ? names.join(" and ").toLowerCase() : "leaves";
}

function glassPhrase(glass) {
  const g = (glass || "").trim();
  if (!g) return "a chilled glass";
  // "Coupe or Martini" → "a coupe or martini glass"; don't append "glass" to
  // things that already name the vessel.
  // Word boundaries matter: "marTINi" contains "tin", which was suppressing the
  // noun and leaving drinks "served in a martini".
  const needsGlass = !/\b(glass|mug|flute|tin|cup)\b/i.test(g);
  const phrase = `${g.toLowerCase()}${needsGlass ? " glass" : ""}`;
  // No vessel in the set starts with a "yu" sound ("a unicorn"), so the plain
  // vowel test is safe here.
  return `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

// Step-by-step build instructions, composed from the method, glassware and
// garnish. This is the part of a recipe page that is genuinely useful to a
// reader and absent from the raw data — the flashcards teach the ingredient
// list, these pages teach the execution.
export function buildSteps(c) {
  const method = getMethod(c);
  const { components: parsed, garnishes } = parseIngredients(c.ingredients);
  const glass = glassPhrase(c.glass);
  const steps = [];

  // A float goes on after the drink is finished and a rinse coats the glass
  // before it is poured, so neither belongs in the shaker with everything
  // else — a Penicillin's Islay float was being shaken into the drink it is
  // supposed to sit on top of. A layered drink is the exception: there the
  // float IS the layering, so leave it in sequence.
  const layered = method === "Layered";
  // A layered drink with a float has a base and something set on top of it — a
  // Baby Guinness's cream. Only a drink whose every component is a layer gets
  // poured over the back of a spoon.
  const floats = parsed.filter(x => x.role === "float");
  const rinses = layered ? [] : parsed.filter(x => x.role === "rinse");
  // A topper only needs pulling out when the drink is mixed somewhere else and
  // strained: a Seelbach's Champagne was going into the mixing glass and being
  // strained back out again. In a build the topper is already last in the list
  // and goes into the glass in the right order.
  const strained = method === "Shaken" || method === "Stirred";
  const toppers = strained ? parsed.filter(x => /^(top|splash)$/i.test(x.measure)) : [];
  const held = new Set([...floats, ...rinses, ...toppers]);
  // "Where not specified" is the whole point of the default: a recipe that
  // states its own sequence keeps it. Berry's Zombie pours lime before
  // falernum and the IBA's Aperol Spritz leads with the prosecco, and neither
  // is the default order. A layered drink's sequence IS the recipe.
  const asWritten = layered || c.order === "as-written";
  const components = asWritten ? parsed.filter(x => !held.has(x))
                               : inBuildOrder(parsed.filter(x => !held.has(x)));
  const list = components.map(x => x.text).join(", ");

  for (const r of rinses) {
    steps.push(`Rinse ${glass} with ${stripTrailingUnit(r.text)}, swirl to coat, and discard the excess.`);
  }

  if (method === "Shaken") {
    steps.push(`Add ${list} to a cocktail shaker.`);
    const herbs = components.filter(x => HERBS.test(x.item));
    if (herbs.length) {
      steps.push(`Press the ${herbNoun(herbs)} gently with a muddler to release the oils — enough to perfume the drink, not enough to shred the leaves.`);
    }
    if (/egg white/i.test(c.ingredients)) {
      steps.push("Dry-shake without ice for about 10 seconds to emulsify the egg white and build foam.");
    }
    steps.push("Fill the shaker with ice and shake hard for 10–12 seconds, until the tin is frosted and well chilled.");
    steps.push(`Double-strain into ${serveTarget(c, glass)}.`);
  } else if (method === "Stirred") {
    steps.push(`Add ${list} to a mixing glass.`);
    steps.push("Fill with ice and stir for 20–30 seconds, until well chilled and properly diluted.");
    steps.push(`Strain into ${serveTarget(c, glass)}.`);
  } else if (method === "Built, Stirred" || method === "Built, Not Stirred"
             || method === "Built, Swizzled") {
    // Both builds are assembled in the serving vessel and differ only in the
    // last step, so they share everything up to it. Within that, a soda
    // highball, a muddled Old Fashioned and a hot toddy still do not start the
    // same way: ice is wrong for a hot drink, and the sugar has to be dealt
    // with before the ice goes in.
    const fizzy = CARBONATED.test(c.ingredients);
    const hot = c.serve === "hot";
    const crushed = c.serve === "over crushed ice";
    const neat = c.serve === "neat";
    const iced = c.serve === "on the rocks" || crushed;
    const SWEETENER = /sugar|syrup|bitters|disc of lime/i;
    // Fruit that is pressed rather than poured. A Caipirinha's lime is the
    // drink, not a garnish — every other "Lime wedge" in the deck is unmeasured
    // and parses into the garnish bucket, so it never reaches this.
    const MUDDLED_FRUIT = /lime \(cut into wedges\)|disc of lime/i;
    // Herbs and pressed fruit go into the muddle with the sugar, and either is
    // enough to call for one alone: a Mint Julep has no sugar cube and is still
    // muddled.
    const MUDDLE_BASE = new RegExp(`${SWEETENER.source}|${HERBS.source}|${MUDDLED_FRUIT.source}`, "i");
    const muddled = /sugar cube|muddle/i.test(c.ingredients)
      || components.some(x => HERBS.test(x.item) || MUDDLED_FRUIT.test(x.item));
    // An all-spirit build — no juice, no mixer, nothing to marry — is stirred
    // for dilution and nothing else, which takes as long as any mixing glass.
    const spiritForward = !fizzy && !CITRUS.test(c.ingredients.toLowerCase());

    if (hot) {
      steps.push(`Preheat ${glass} by rinsing it with boiling water, then discard.`);
      steps.push(`Add ${list} to the warmed glass and stir until the sugar has dissolved.`);
    } else {
      if (muddled) {
        const base = components.filter(x => MUDDLE_BASE.test(x.item));
        const rest = components.filter(x => !MUDDLE_BASE.test(x.item));
        // Sugar wants dissolving and leaves want bruising, and the two are not
        // the same instruction — muddled like sugar, mint turns bitter and black.
        const herbs = base.filter(x => HERBS.test(x.item));
        const sweet = base.some(x => /sugar|syrup/i.test(x.item));
        const fruit = base.some(x => MUDDLED_FRUIT.test(x.item));
        const how = herbs.length
          ? (sweet
            ? `muddle gently — enough to release the oils from the ${herbNoun(herbs)} and dissolve the sugar, not enough to shred the leaves`
            : `press gently with a muddler to release the oils, without shredding the leaves`)
          : fruit
            ? "muddle firmly, until the sugar has dissolved and the fruit has given up its juice and oils"
            : "muddle until the sugar dissolves";
        steps.push(`Add ${base.map(x => x.text).join(", ")} to ${glass} and ${how}.`);
        // A Champagne Cocktail is nothing but sugar and bitters until the wine
        // goes in, and the wine reads as a garnish — leaving nothing to add.
        if (rest.length) {
          steps.push(iced
            ? `Fill with ${crushed ? "crushed ice" : "ice"} and add ${rest.map(x => x.text).join(", ")}.`
            : `Add ${rest.map(x => x.text).join(", ")}.`);
        } else if (iced) {
          steps.push("Fill with ice.");
        }
      } else {
        if (iced) steps.push(`Fill ${glass} with ${crushed ? "crushed ice" : "fresh ice"}.`);
        steps.push(`Add ${list} directly to ${iced ? "the glass" : glass}, in order.`);
      }
      // Not every build is stirred, and saying so where it is false ruins the
      // drink: stirring a Kir or a Champagne Cocktail costs the bubbles, and
      // stirring a Sombrero pulls the cream down through the coffee liqueur.
      if (method === "Built, Not Stirred") {
        steps.push(fizzy
          ? "Do not stir — the pour mixes it, and stirring would cost the bubbles."
          : "Do not stir. Serve as poured.");
      } else if (method === "Built, Swizzled") {
        // The stick goes to the bottom of the glass and is spun between the
        // palms. Where there is crushed ice that drives the ice up through the
        // drink and frost on the outside says when to stop; a Ti' Punch is
        // swizzled over no ice at all, so there is nothing to churn or frost
        // and the swizzle only has to dissolve the sugar.
        steps.push(crushed
          ? "Insert a swizzle stick to the bottom of the glass and spin it between your palms, drawing the crushed ice up through the drink, until a thick frost forms on the outside. Top with more crushed ice."
          : "Insert a swizzle stick into the glass and spin it between your palms to swizzle the drink, just until the sugar has dissolved and everything is combined.");
      } else if (crushed && fizzy) {
        // A Mojito is stirred, not swizzled: a slow lift from the bottom to
        // bring the mint up, gentle enough to leave the soda its bubbles.
        steps.push("Stir gently from the bottom up to lift the mint, without knocking out the carbonation. Top with more crushed ice.");
      } else if (crushed) {
        // A julep is stirred hard rather than swizzled, but wants the same
        // tell: keep going until the outside of the cup frosts over.
        steps.push("Stir vigorously for 15–20 seconds, until the outside of the vessel frosts. Pack with more crushed ice, mounding it over the top.");
      } else if (neat) {
        steps.push("Stir briefly to combine, and serve as it is — no ice, at room temperature.");
      } else if (fizzy) {
        steps.push("Stir gently once or twice to combine without knocking out the carbonation.");
      } else if (iced && spiritForward) {
        // An Old Fashioned's stir IS its dilution, and it takes as long in the
        // glass as it would in a mixing glass. "Briefly" is what you do to a
        // rum and coke.
        steps.push("Stir for 20–30 seconds, until well chilled and properly diluted.");
      } else {
        steps.push(iced ? "Stir briefly to combine and chill." : "Stir briefly to combine.");
      }
    }
  } else if (method === "Rolled") {
    // Rolling is the Bloody Mary answer to a base that neither shaking nor
    // stirring suits: shaking whips the tomato juice to a froth and blunts the
    // seasoning, and stirring in the glass never mixes it at all.
    steps.push(`Add ${list} to a shaker tin with ice.`);
    steps.push("Pour the drink from one tin to the other in a long, slow stream, four or five times, until it is mixed and chilled without being aerated.");
    steps.push(`Strain into ${serveTarget(c, glass)}.`);
  } else if (method === "Blended") {
    steps.push(`Add ${list} to a blender along with about a cup of crushed ice.`);
    steps.push("Blend on high until completely smooth, with no ice shards left.");
    steps.push(`Pour into ${glass}.`);
  } else if (method === "Flash Blend") {
    steps.push(`Add ${list} to a blender along with about 6 oz of crushed ice.`);
    steps.push("Blend at high speed for no more than 5 seconds. This is a whip, not a frozen drink — just long enough to chill and marry the ingredients, with the ice still in shards.");
    steps.push(`Pour unstrained into ${glass}, then add ice cubes to fill.`);
  } else if (method === "Thrown") {
    const lit = /ignited|flamed/i.test(c.ingredients);
    steps.push(`Combine ${list} in the first of two warmed, handled mugs.`);
    steps.push(lit
      ? "Ignite the mixture, then pour the blazing stream back and forth between the mugs four or five times, widening the arc as you go — done well it reads as one unbroken ribbon of fire."
      : "Pour the mixture back and forth between the two vessels in a long stream, four or five times, to aerate and chill it.");
    steps.push(`Serve in ${glass}.`);
  } else if (method === "Heated") {
    steps.push(`Combine ${list} in a saucepan.`);
    steps.push("Warm gently over a low heat for 20–30 minutes. Do not let it boil — that drives off the alcohol and turns the spices bitter.");
    steps.push(`Ladle into ${glass}.`);
  } else if (method === "Dropped") {
    steps.push(`Half-fill ${glass} with the mixer.`);
    steps.push("Pour the spirit into a separate shot glass.");
    steps.push("Drop the shot glass into the larger one and drink straight down, before the fizz subsides.");
  } else if (method === "Chased") {
    steps.push(`Pour the spirit into ${glass} and the chaser into a second one. Nothing is mixed.`);
    steps.push("Drink the spirit first, then the chaser immediately behind it.");
  } else if (method === "Layered") {
    // A layered drink with a float has a base with something set on top of it —
    // a Baby Guinness's cream. Only a drink whose every component is a layer is
    // poured over the back of a spoon; the float is added further down.
    if (floats.length) {
      steps.push(`Pour ${list} into ${serveTarget(c, glass)}.`);
    } else {
      steps.push(`Pour ${list} slowly over the back of a bar spoon, in the order listed.`);
      steps.push(`Take care to keep each layer distinct in ${glass}.`);
    }
  } else {
    // Every method above is matched by name. Reaching here means a recipe
    // carries a `method` no branch handles — a typo, or a technique added to
    // the data before its steps were written. This used to fall into the
    // layering branch, so a misspelt method quietly instructed the reader to
    // pour a Mint Julep over the back of a bar spoon. Say nothing rather than
    // something wrong.
    steps.push(`Combine ${list} and serve in ${glass}.`);
  }

  for (const t of toppers) {
    steps.push(`Top with ${t.item}.`);
  }

  for (const f of floats) {
    const verb = /drizzle/i.test(f.text) ? "Drizzle" : "Float";
    steps.push(`${verb} ${stripTrailingUnit(f.text)} over the top.`);
  }

  if (garnishes.length) {
    steps.push(`Garnish with ${garnishes.join(", ").toLowerCase()}.`);
  }
  return steps;
}

// One-line summary used as the page's meta description and its opening line.
export function summarize(c) {
  const method = methodAdjective(getMethod(c));
  const { components } = parseIngredients(c.ingredients);
  const named = components.slice(0, 3).map(x => x.item.replace(/\s*\([^)]*\)/g, "")).join(", ");
  return `A ${method} cocktail made with ${named}, served in ${glassPhrase(c.glass)}.`;
}

// ── The ingredient lexicon and its sampling distribution ───────────────────
//
// The vocabulary of the recipe corpus — every distinct ingredient name — with a
// unigram distribution over it, used to draw plausible wrong answers for the
// "86 It" quiz. Frequency is the whole point: an ingredient in 74 recipes is a
// far better wrong answer than one that appears once, because the question
// worth asking is "does this belong in THIS drink", not "have you ever heard of
// this".
//
// (The assessment-theory term for a wrong option is a *distractor*. This file
// says "impostor" throughout because that is the game's own word — the menu
// button reads "86 It — Spot the Impostors" — and one vocabulary for the
// feature beats a more correct one that no longer matches the screen.)

// An impostor has to read as an ingredient on its own. These do not: stated
// alternatives ("Bourbon or Rye"), and entries carrying an instruction
// ("Sugar — muddle lime and sugar").
const NOT_AN_INGREDIENT = /\bor\b|—/;

// Trailing qualifiers are display detail rather than part of the name. Dropping
// them is what lets a real ingredient and an impostor read in the same voice:
// if only the real ones ever said "(optional)" or "(float)", the game would
// give itself away without the player knowing a thing about the drink.
export function ingredientLabel(item) {
  return (item || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// The ingredient names of one recipe, cleaned and de-duplicated. Two entries
// can clean to the same label — a recipe listing both "Angostura Bitters" and
// "Angostura Bitters (float)" means one ingredient, not two checkboxes.
export function ingredientLabels(c) {
  const seen = [];
  for (const x of parseIngredients(c.ingredients).components) {
    const label = ingredientLabel(x.item);
    if (label && !seen.includes(label)) seen.push(label);
  }
  return seen;
}

// Sampling straight from the unigram distribution is not sharp enough, and the
// shape of the corpus is why. 242 types share 1211 tokens, but 124 of those
// types are hapax legomena — they occur exactly once — and drawn in proportion
// to their frequency that tail takes 10% of every draw between them. Two
// impostors a question, ten questions a round, and a player meets roughly two
// ingredients-from-nowhere per round, which is how Tawny Port at 1/1211 on its
// own still turns up often enough to look like no weighting at all.
//
// The standard remedy is to sample from a power-smoothed unigram distribution:
// raise each probability to an exponent and renormalise. It is the same
// transform word2vec uses to pick negative samples, at U(w)^0.75 — and this is
// the same problem, drawing plausible wrong answers from a term distribution.
// The sign of the correction is the difference: an exponent below 1 flattens
// the distribution to give rare terms more of the draw, which is what word2vec
// wants; above 1 it sharpens, which is what this quiz wants. Equivalently it is
// a temperature of 1/ALPHA = 0.67, below 1 and so peaked.
//
// The ranking never changes, only the gaps. At 1.5 the hapax tail falls from
// 10% of draws to 2.4% — one obscure ingredient every other round rather than
// two a round — while Fresh Lemon Juice doubles to 12%. Push ALPHA higher and
// the head of the distribution starts repeating instead, which reads just as
// mechanical as the tail did.
const ALPHA = 1.5;

// The lexicon: one row per type, carrying `count` (its token count), `frequency`
// (the unigram MLE, count/tokens) and `probability` (the power-smoothed
// distribution the draw actually samples from). Both `frequency` and
// `probability` lie in 0..1 and both sum to 1 across the lexicon — the first
// describes the corpus, the second describes the game.
export function buildLexicon(recipes) {
  const freq = new Map();
  for (const c of recipes) {
    for (const label of ingredientLabels(c)) {
      if (NOT_AN_INGREDIENT.test(label)) continue;
      freq.set(label, (freq.get(label) || 0) + 1);
    }
  }
  const mentions = [...freq.values()].reduce((s, n) => s + n, 0) || 1;
  const table = [...freq].map(([label, count]) => ({
    label,
    count,
    frequency: count / mentions,
  }));
  const smoothed = table.map(e => Math.pow(e.frequency, ALPHA));
  const partition = smoothed.reduce((s, w) => s + w, 0) || 1;
  table.forEach((e, i) => { e.probability = smoothed[i] / partition; });
  return table;
}

// Two names clash when either contains the other. "Gin" cannot be an impostor
// in a Sloe Gin drink and "Angostura Bitters" cannot be one where the recipe
// says "Angostura": both would be defensibly correct answers, and a quiz that
// marks a right answer wrong is worse than no quiz at all.
function clashes(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x.includes(y) || y.includes(x);
}

// Sample n impostors from the lexicon without replacement. Anything that clashes
// with a real ingredient — or with an impostor already drawn — is removed from
// the support before the draw, so a question can never offer the same thing
// twice under two names. That leaves the remaining mass summing to less than 1,
// hence the partition function recomputed per draw.
//
// The sampler is inverse-CDF (roulette-wheel) selection: walk the support
// accumulating mass until it exceeds a uniform draw. Each type therefore owns an
// interval as wide as its probability, which is what makes equal probabilities
// equally likely regardless of where they sit in the array — see the --verify
// mode of scripts/ingredient-frequency.mjs, which measures those widths.
export function drawImpostors(lexicon, realLabels, n, rand = Math.random) {
  const out = [];
  let support = lexicon.filter(e => !realLabels.some(r => clashes(e.label, r)));
  for (let i = 0; i < n && support.length > 0; i++) {
    const partition = support.reduce((s, e) => s + e.probability, 0);
    let r = rand() * partition;
    let pick = support[support.length - 1];
    for (const e of support) { r -= e.probability; if (r <= 0) { pick = e; break; } }
    out.push(pick.label);
    support = support.filter(e => !clashes(e.label, pick.label));
  }
  return out;
}

// A drink needs at least two ingredients to be worth asking about. One recipe
// fails this: the Miami Vice, whose entire ingredient line is prose describing
// two other drinks, so it parses to no measured components at all.
export function eightySixEligible(c) {
  return ingredientLabels(c).length >= 2;
}

// One question: the drink's real ingredients plus one, two or three impostors
// (equally likely), shuffled together. The cocktail is spread in so callers can
// keep treating a question as a recipe — `name` and `rank` still read.
export function buildEightySixQuestion(c, lexicon, rand = Math.random) {
  const real = ingredientLabels(c);
  const impostors = drawImpostors(lexicon, real, 1 + Math.floor(rand() * 3), rand);
  const options = [
    ...real.map(label => ({ label, real: true })),
    ...impostors.map(label => ({ label, real: false })),
  ];
  // Fisher–Yates, or every impostor sits at the bottom of the list.
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { ...c, options };
}

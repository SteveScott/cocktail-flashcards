# Preparation methods

`getMethod()` in [`src/recipe-meta.js`](../src/recipe-meta.js) infers a method from
the ingredient list. The inference is a bar rule of thumb — shake for citrus,
egg, dairy, purée or espresso; stir anything spirit-and-sugar; build anything
tall with a mixer in it — and it is right for most of the 321 recipes.

It is wrong for a specific, knowable set of them, because a method is a fact
about a recipe, not a function of its ingredients. Nothing in "bourbon, sugar,
bitters" says an Old Fashioned is assembled in the glass rather than a mixing
glass, and nothing in "rum, lime, falernum" says a Zombie is whipped in a
blender for five seconds. Those drinks carry an explicit `"method"` on the
recipe, which `getMethod()` returns before it tries to infer anything.

**An override needs a source.** The rule of thumb is a guess, and replacing it
with a different guess is no improvement. Everything below is the published
method from the drink's governing authority — the IBA's official specification
where it has one, otherwise the originating bartender or the standard reference
for that drink. Add to this table when you add an override.

## Built in the serving vessel

The largest group, and the one the rule of thumb gets wrong most often: these
read as spirit-and-sugar drinks, so inference calls them Stirred, but every one
is assembled in the glass it is served in.

| Drink | Source |
|---|---|
| Old Fashioned | [IBA](https://iba-world.com/iba-cocktail/old-fashioned/): "Place sugar cube in old fashioned glass and saturate with bitter… Fill the glass with ice cubes and add whiskey. Stir gently." |
| Rum Old Fashioned | Same build as the Old Fashioned |
| Tequila Old Fashioned | Same build as the Old Fashioned |
| Champagne Cocktail | [IBA](https://iba-world.com/iba-cocktail/champagne-cocktail/): "Place the sugar cube with 2 dashes of bitters in a large Champagne glass, add the cognac. Pour gently chilled Champagne." |
| Irish Coffee | [IBA](https://iba-world.com/iba-cocktail/irish-coffee/): coffee poured into a preheated glass, whiskey and sugar stirred in, cream floated over the back of a spoon |
| Horse's Neck | [IBA](https://iba-world.com/iba-cocktail/horses-neck/): "Pour Cognac and ginger ale directly into highball glass with ice cubes. Stir gently." |
| Black Russian | [IBA](https://iba-world.com/iba-cocktail/black-russian/): "Pour the ingredients into the old fashioned glass filled with ice cubes. Stir gently." |
| Rusty Nail | [IBA](https://iba-world.com/iba-cocktail/rusty-nail/): "Pour all ingredients directly into an old fashioned glass filled with ice. Stir gently." |
| Kir | [IBA](https://iba-world.com/iba-cocktail/kir/): "Pour Crème de Cassis into glass, top up with white wine." |
| Kir Royale | IBA, as the Kir Royal variant of the above: "Use Champagne instead of white wine" |
| Godfather | Poured into an ice-filled old fashioned glass and stirred ([Difford's](https://www.diffordsguide.com/cocktails/recipe/864/godfather-cocktail)) |
| Godmother | The vodka counterpart, same build ([Difford's](https://www.diffordsguide.com/cocktails/recipe/9219/godmother)) |
| Milano Torino | Built in an old fashioned glass over ice, stirred briefly ([Difford's](https://www.diffordsguide.com/cocktails/recipe/3495/milano-torino-mi-to-cocktail)) |
| Whisky Mac | Poured into the glass and swirled — traditionally with no ice at all ([Master of Malt](https://www.masterofmalt.com/blog/post/whisky-mac-cocktail-recipe/)) |
| Death in the Afternoon | Hemingway, *So Red the Nose* (1935): "Pour one jigger absinthe into a Champagne glass. Add iced Champagne until it attains the proper opalescent milkiness." |
| Ti' Punch | Built in the glass, traditionally without ice, roused with a *bois lélé* ([Imbibe](https://imbibemagazine.com/introduction-ti-punch/)) |
| Treacle | Dick Bradsell built it in the serving glass — "rather than use a stirring glass, Dick made this cocktail directly in the glass" ([Difford's](https://www.diffordsguide.com/cocktails/recipe/1983/treacle-no1)) |
| Hot Toddy | Built in a preheated mug; you do not shake boiling water |
| Hot Buttered Rum | Batter into a preheated mug, then rum and hot water, stirred to melt ([Saveur](https://www.saveur.com/article/Wine-and-Drink/Hot-Buttered-Rum)) |
| Tom & Jerry | Batter into a warmed mug, then spirit and hot milk, stirred to a foam ([Saveur](https://www.saveur.com/article/Recipes/Tom-and-Jerry)) |
| Spanish Coffee | Built and flamed in the glass tableside at Huber's, Portland ([PUNCH](https://punchdrink.com/articles/hubers-spanish-coffee-hot-cocktail/)) |
| Sombrero | Coffee liqueur poured over ice, cream floated on top — the cream sitting on the liqueur "like a hat" is the whole drink |
| Prairie Fire | Built in the shot glass |
| Seven & Seven | A two-ingredient highball, built over ice |
| True Blood | Built in the glass and topped with wine. `BUILT_MIXERS` does not list wine, so inference falls through to Shaken on the cranberry juice — which would shake the wine through the drink instead of leaving it on top. Adding wine to that list would reclassify Sangria as a side effect, so this is an override rather than a rule change. |

## Layered

Poured over the back of a spoon so the layers hold.

| Drink | Source |
|---|---|
| Black Velvet | Champagne first, stout floated over a spoon to keep the bands distinct ([Wikipedia](https://en.wikipedia.org/wiki/Black_velvet_(cocktail))) |
| Snakebite | Cider first, lager poured over the back of a spoon ([Craft Beering](https://www.craftbeering.com/snakebite-drink-beer-cider/)) |
| Baby Guinness | Irish cream floated over coffee liqueur to make the miniature pint's head ([Wikipedia](https://en.wikipedia.org/wiki/Baby_Guinness)) |
| True Blood | The base is built over ice and the red wine set on top as its own layer. Inference cannot see it: BUILT_MIXERS does not list wine, so the cranberry juice sends the drink to Shaken, which would mix the wine straight through. |

## Shaken

Dairy the shake rule misses, because it looks for *heavy* cream and
half-and-half rather than plain milk or cream.

| Drink | Source |
|---|---|
| Brandy Milk Punch | Shaken hard with ice and strained ([Saveur](https://www.saveur.com/article/recipes/brennans-brandy-milk-punch-recipe/)) |
| Toasted Almond | Shaken to chill and froth the dairy |

## Blended

| Drink | Source |
|---|---|
| Sgroppino | Sorbet, vodka and prosecco whisked or immersion-blended to a froth ([Saveur](https://www.saveur.com/article/Recipes/Sgroppino-Cocktail/)) |

## Techniques the inference has no rule for

These needed new method values, and each has its own branch in `buildSteps()`.

| Drink | Method | Source |
|---|---|---|
| Zombie | Flash Blend | [Beachbum Berry](https://beachbumberry.com/recipe-zombie.html) and [IBA](https://iba-world.com/iba-cocktail/zombie/): blended with crushed ice for no more than 5 seconds |
| Blue Blazer | Thrown | Jerry Thomas, *How to Mix Drinks* (1862): ignite, then pour the blazing stream between two mugs four or five times |
| Mulled Wine | Heated | Warmed in a saucepan below a simmer; not a cocktail technique at all |
| Jägerbomb | Dropped | A [bomb shot](https://en.wikipedia.org/wiki/Bomb_shot) — the shot glass is dropped into the mixer |
| Pickleback | Chased | Nothing is mixed: the whiskey is drunk, then the brine ([Wikipedia](https://en.wikipedia.org/wiki/Pickleback)) |

## Checked and deliberately left alone

Inference already agrees with the published method for these, so they carry no
override. They are listed because they look like candidates and someone will
otherwise re-check them.

| Drink | Method | Source |
|---|---|---|
| Sazerac | Stirred | [IBA](https://iba-world.com/iba-cocktail/sazerac/): "Stir the remaining ingredients over ice in a mixing glass" after rinsing the glass with absinthe |
| Stinger | Stirred | [IBA](https://iba-world.com/iba-cocktail/stinger/): "Pour all ingredients into mixing glass with ice cubes. Stir well. Strain." |
| Seelbach | Stirred | Difford's stirs the base over ice and double-strains into the flute before topping with Champagne |
| Harvard | Stirred | Stirred and strained; the soda is a splash on top, not a build |

## Serving style

Every recipe carries a `serve`. It is a fact about the drink that glassware
cannot supply: a Sazerac and an Old Fashioned are both rocks glasses, and only
one of them has ice in it.

| Value | Meaning |
|---|---|
| `up` | Chilled, served without ice. |
| `neat` | No ice **and never chilled** — poured and drunk at room temperature. |
| `on the rocks` | Over ice cubes. |
| `over crushed ice` | Over crushed or pebble ice: juleps, swizzles, cobblers, tiki. |
| `hot` | Served hot. Seven drinks. |
| `frozen` | Blended to a slush. Six drinks. |

**Up and neat are not the same thing, and the difference is temperature.** Up is
chilled — stirred or shaken against ice and then served off it. Neat is never
chilled at all. Two drinks are neat by tradition rather than by glassware:

| Drink | Source |
|---|---|
| Ti' Punch | No ice in Martinique, and the rhum is better for it — traditionalists drink it above 80°F ([Imbibe](https://imbibemagazine.com/introduction-ti-punch/), [VinePair](https://vinepair.com/cocktail-college/ti-punch/)) |
| Whisky Mac | Poured and swirled with no ice, to keep the ginger wine from thinning ([Master of Malt](https://www.masterofmalt.com/blog/post/whisky-mac-cocktail-recipe/)) |

`hot` and `frozen` are additions beyond those four: an Irish Coffee and a Frozen
Margarita are not up, neat, on the rocks or over crushed ice, and forcing either
into one of those would be a lie on the card.

`serve` drives the generated steps, so the instructions now say where the drink
lands — "Strain into a chilled rocks glass" for a Sazerac, "Double-strain into a
rocks or tiki glass packed with crushed ice" for a Mai Tai — and it is shown on
the flashcard and the recipe page alongside the glass and the method.

It also feeds one method rule: a drink served over crushed ice with nothing to
shake is built in the glass. That is what keeps a Mint Julep and an Absinthe
Frappé reading as builds now that crushed ice is a serving style rather than an
ingredient in their lists.

Values a rule cannot reach are set by hand: the Sazerac (chilled, ice discarded,
so `up` in a rocks glass) and the cold-but-uniced Kir, Snakebite, Boilermaker,
Eggnog and Jägerbomb.

## Units written after the ingredient

A float, a drizzle, a splash and a rinse are amounts of liquid, no different
from an ounce — the data just writes the unit after the ingredient rather than
before it. `parseIngredients()` reads them all as measures, so "Dark Rum float"
parses as *Float* of *Dark Rum* rather than dropping into the garnish bucket as
something unmeasured.

Being an ingredient is not the same as being poured in with everything else, so
each carries a `role` saying where it goes in the sequence:

| Unit | Placement |
|---|---|
| `rinse` | First. The glass is coated and the excess discarded before anything is poured — a Sazerac's absinthe. |
| `float`, `drizzle` | Last, on the finished drink: a Mai Tai's dark rum, a Penicillin's Islay, a Bramble's crème de mûre. |
| `top`, `splash` | After straining, but only for a drink mixed somewhere else. In a build the topper is already last in the list and goes in in order. |

A layered drink is not an exception. A float there marks a base with something
set on top of it — a True Blood's wine over its vodka and cranberry, a Baby
Guinness's cream over its coffee liqueur — and the steps say so. Only a drink
whose every component is a layer, like a B-52 or a Black Velvet, is poured over
the back of a spoon.

This matters more than the garnish line suggests: nine of the eleven floats in
the deck already carried a leading measure, so they parsed as ordinary
ingredients and were being shaken or stirred into the drink they are supposed
to sit on top of.

## Ingredient order

Order is part of the method. Where a recipe does not state its own sequence,
ingredients go in:

**liquor → citrus → syrup → juice → dashes, floats and splashes**

"Liquor" means everything alcoholic, liqueurs included — which is how the data
already writes it: a Last Word, a Sidecar, a Margarita and a Paper Plane all
group the liqueur with the base spirit, ahead of the citrus. Carbonated mixers
rank last whatever their volume, since a Moscow Mule's four ounces of ginger
beer is still the thing that goes in on top. The sort is stable, so ingredients
the ranking cannot separate keep the order the recipe wrote them in.

The `ingredients` strings are stored in this order too, so a flashcard and the
recipe page generated from it agree. `canonicalIngredientOrder()` is the one
implementation of the rule and `buildSteps()` uses the same ranking, which is
why normalising 46 recipes changed no generated step at all.

`order: "as-written"` opts a recipe out, for the "where not specified" case —
the sequence is either sourced or structural and the default would break it:

| Recipe | Why it is pinned |
|---|---|
| Aperol Spritz | The [IBA](https://iba-world.com/iba-cocktail/spritz/) builds prosecco, then Aperol, then soda — the 3-2-1 |
| Caipirinha, Caipiroska | The lime and sugar are muddled together first; the order is the technique |
| Michelada, Chelada | Built on the beer, which the default would rank as a topper and send to the end |
| Trinidad Sour | Angostura is the base spirit here, not a dash |
| Blue Blazer | Scotch and boiling water go into the mug before the sugar |

Layered drinks are never reordered — the sequence *is* the recipe.

Two candidates were checked and **not** pinned. Difford's orders the
Don-the-Beachcomber tiki drinks in the default order — Three Dots and a Dash as
*rums, falernum, allspice dram, lime, orange, honey, dash* — so the deck's old
sequence was inconsistent data rather than preserved sourcing. And the
[IBA's Mimosa](https://iba-world.com/iba-cocktail/mimosa/) pours the juice
before the sparkling wine, which is the default rule anyway.

The Zombie is not pinned either. Berry's own published order lists the juice
first and the rums last — a juice-first convention this deck does not use
anywhere — so its sequence here was never his to preserve.

## Known gaps

- `Built` reads "hot" off the ingredient text, so a drink whose name contains a
  hot-sounding ingredient other than hot sauce could still be sent to a
  preheated glass.
- Other unmeasured parts still land in the garnish bucket where they are really
  ingredients or instructions: a Whiskey Sour's bare "Angostura Bitters", a Mint
  Julep's "Crushed Ice", a Caipirinha's "add cachaça", a Carajillo's "layer
  espresso on top". Each needs a decision about what the data should say, not a
  parser rule.
- "Julep Tin or Rocks" and "Punch Cup or Rocks" read as "a julep tin or rocks",
  because the vessel-noun suppression fires on the first alternative.

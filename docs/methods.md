# Preparation methods

`getMethod()` in [`src/recipe-meta.js`](../src/recipe-meta.js) infers a method from
the ingredient list. The inference is a bar rule of thumb — shake for citrus,
egg, dairy, purée or espresso; stir anything spirit-and-sugar; build anything
tall with a mixer in it — and it is right for most of the 322 recipes.

## The vocabulary

**"Built" on its own was ambiguous and is gone.** It named where a drink is
assembled and said nothing about what you then do to it, which put a Gin & Tonic,
an Old Fashioned, a Mint Julep and a Sombrero under one word. The two builds are
now named for the step that actually differs:

| Method | Where it is mixed | What you do to it |
|---|---|---|
| `Shaken` | tin | shaken hard, strained out |
| `Stirred` | mixing glass | stirred, strained out |
| `Built, Stirred` | the serving vessel | stirred where it stands |
| `Built, Not Stirred` | the serving vessel | nothing — the pour is the mixing |
| `Rolled` | between two tins | poured back and forth |
| `Layered` | the serving vessel | kept apart on purpose |

Two notes on the edges of that table.

**A float is not a layer.** A drink is `Layered` only when components that make
up its *body* must stay separate — a B-52, a Black Velvet. Something set on top
of a finished drink is a float, it carries `role: "float"` from
`parseIngredients()`, and it gets its own closing step; the method describes the
rest of the drink underneath it. A Mai Tai is `Shaken` with a rum float, a
Sombrero is `Built, Not Stirred` with a cream float. The Baby Guinness is the
case that looks like an exception and is not: its cream is a float *and* stays
as its own unmixed band, which is the whole drink, so it is `Layered`.

**Swizzling is not its own method.** It is a real and distinct technique — a
swizzle stick spun between the palms, churning crushed ice up through the drink
until the vessel frosts, which chills harder and faster than stirring cubes
past each other. But it is a way of stirring in the glass, so a swizzled drink
is `Built, Stirred` and the churn is spelled out in its generated steps rather
than adding a word to the card that a learner would have to look up.

Eleven drinks are swizzles, and the three that say so in their names —
Queen's Park, Chartreuse, Bermuda Rum — need overrides, because the shake rule
reaches their citrus before the crushed-ice rule reaches their ice.

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

## Built, Stirred

The largest group, and the one the rule of thumb gets wrong most often: these
read as spirit-and-sugar drinks, so inference calls them Stirred, but every one
is assembled — and stirred — in the glass it is served in.

| Drink | Source |
|---|---|
| Old Fashioned | [IBA](https://iba-world.com/iba-cocktail/old-fashioned/): "Place sugar cube in old fashioned glass and saturate with bitter… Fill the glass with ice cubes and add whiskey. Stir gently." |
| Rum Old Fashioned | Same build as the Old Fashioned |
| Tequila Old Fashioned | Same build as the Old Fashioned |
| Irish Coffee | [IBA](https://iba-world.com/iba-cocktail/irish-coffee/): coffee poured into a preheated glass, whiskey and sugar stirred in, cream floated over the back of a spoon |
| Horse's Neck | [IBA](https://iba-world.com/iba-cocktail/horses-neck/): "Pour Cognac and ginger ale directly into highball glass with ice cubes. Stir gently." |
| Black Russian | [IBA](https://iba-world.com/iba-cocktail/black-russian/): "Pour the ingredients into the old fashioned glass filled with ice cubes. Stir gently." |
| Rusty Nail | [IBA](https://iba-world.com/iba-cocktail/rusty-nail/): "Pour all ingredients directly into an old fashioned glass filled with ice. Stir gently." |
| Godfather | Poured into an ice-filled old fashioned glass and stirred ([Difford's](https://www.diffordsguide.com/cocktails/recipe/864/godfather-cocktail)) |
| Godmother | The vodka counterpart, same build ([Difford's](https://www.diffordsguide.com/cocktails/recipe/9219/godmother)) |
| Milano Torino | Built in an old fashioned glass over ice, stirred briefly ([Difford's](https://www.diffordsguide.com/cocktails/recipe/3495/milano-torino-mi-to-cocktail)) |
| Whisky Mac | Poured into the glass and swirled — traditionally with no ice at all ([Master of Malt](https://www.masterofmalt.com/blog/post/whisky-mac-cocktail-recipe/)) |
| Ti' Punch | Built in the glass, traditionally without ice, roused with a *bois lélé* ([Imbibe](https://imbibemagazine.com/introduction-ti-punch/)) |
| Treacle | Dick Bradsell built it in the serving glass — "rather than use a stirring glass, Dick made this cocktail directly in the glass" ([Difford's](https://www.diffordsguide.com/cocktails/recipe/1983/treacle-no1)) |
| Hot Toddy | Built in a preheated mug; you do not shake boiling water |
| Hot Buttered Rum | Batter into a preheated mug, then rum and hot water, stirred to melt ([Saveur](https://www.saveur.com/article/Wine-and-Drink/Hot-Buttered-Rum)) |
| Tom & Jerry | Batter into a warmed mug, then spirit and hot milk, stirred to a foam ([Saveur](https://www.saveur.com/article/Recipes/Tom-and-Jerry)) |
| Spanish Coffee | Built and flamed in the glass tableside at Huber's, Portland ([PUNCH](https://punchdrink.com/articles/hubers-spanish-coffee-hot-cocktail/)) |
| Seven & Seven | A two-ingredient highball, built over ice |
| Oaxacan Old Fashioned | The same build as the Old Fashioned it is named for. It carried no override and inferred to `Stirred`, so it alone of the four told the reader to use a mixing glass and strain |
| Shirley Temple | Poured over ice and stirred. Its lime and grenadine trip the sour rule, but half an ounce of each under four ounces of ginger ale is not a sour ([Difford's](https://www.diffordsguide.com/cocktails/recipe/1546/shirley-temple)) |
| Queen's Park Swizzle | Swizzled, never shaken: the stick goes to the bottom of the crushed ice and is spun between the palms until a thick frost forms on the glass, which also keeps the mint, ice and bitters in their three bands ([Wikipedia](https://en.wikipedia.org/wiki/Queen%27s_Park_Swizzle), [PUNCH](https://punchdrink.com/recipes/queens-park-swizzle/)) |
| Chartreuse Swizzle | Marcovaldo Dionysos, Tres Agaves, San Francisco, 2002. Churned with crushed ice until the glass frosts — "it's not a Swizzle without the ice, and that ice best be crushed" ([Imbibe](https://imbibemagazine.com/recipe/chartreuse-swizzle-recipe/)) |
| Bermuda Rum Swizzle | Traditionally swizzled with a stick cut from an allspice tree, spun between the palms until the drink froths ([Wikipedia](https://en.wikipedia.org/wiki/Rum_swizzle), [The Bermudian](https://www.thebermudian.com/food-a-drink/recipes/traditional-bermuda-rum-swizzle/)). A shaker is a common modern substitute, but the island method is the one the drink is named for |

A build's last step reads the narrower `CARBONATED` list to decide whether
stirring costs you bubbles. `stout` was added to it for Nico's Bloody Mary: a
stout is carbonated, and the head is the point of pouring one over a tomato
base, but the list only named `beer` — which "Guinness Stout" does not contain —
so the drink was being told to stir briefly rather than gently. It changes the
generated steps of no other recipe; every other stout in the deck (Black Velvet,
Snakebite, Baby Guinness) is `Layered` and never reaches that branch.

## Built, Not Stirred

Assembled in the serving vessel like the group above, and then left alone. The
reason is usually carbonation — stirring a Kir or a Champagne Cocktail pours the
bead away — but it can also be that there is nothing to mix, or that mixing is
the one thing that would ruin the drink.

| Drink | Source |
|---|---|
| Champagne Cocktail | [IBA](https://iba-world.com/iba-cocktail/champagne-cocktail/): "Place the sugar cube with 2 dashes of bitters in a large Champagne glass, add the cognac. Pour gently chilled Champagne." — no stir; the pour is the mixing, and stirring costs the bead |
| Kir | [IBA](https://iba-world.com/iba-cocktail/kir/): "Pour Crème de Cassis into glass, top up with white wine." The wine going in mixes it |
| Kir Royale | IBA, as the Kir Royal variant of the above: "Use Champagne instead of white wine" |
| Death in the Afternoon | Hemingway, *So Red the Nose* (1935): "Pour one jigger absinthe into a Champagne glass. Add iced Champagne until it attains the proper opalescent milkiness." The louche spreading through the glass *is* the mixing |
| Sombrero | Coffee liqueur poured over ice, cream floated on top — the cream sitting on the liqueur "like a hat" is the whole drink, and stirring it destroys it |
| True Blood | Built over ice and not stirred, with the red wine floated on top. The float is a float, not a layer: the method describes the vodka, raspberry liqueur and cranberry underneath it |
| Prairie Fire | Built in the shot glass; the hot sauce disperses on its own |

**The True Blood is a house cocktail from QXT's, and has no external source.**
Searching for it turns up an unrelated drink of the same name — vodka, rum,
peach schnapps, orange juice and grenadine — which is not this recipe. Do not
reconcile this entry against it. The measurements here are the house build, and
the owner of the recipe is the authority on them.

## Rolled

Poured back and forth between two tins. Inferred rather than overridden: a
tomato or Clamato base is the whole rule, and it is the only base in the deck
that suits neither tin nor glass. Shaking whips tomato juice to a froth and
blunts the seasoning; stirring it in the glass never mixes it at all.

Four drinks: Bloody Mary, Bloody Caesar, Nico's Bloody Mary, Virgin Mary.


## Layered

Poured over the back of a spoon so the layers hold.

| Drink | Source |
|---|---|
| Black Velvet | Champagne first, stout floated over a spoon to keep the bands distinct ([Wikipedia](https://en.wikipedia.org/wiki/Black_velvet_(cocktail))) |
| Snakebite | Cider first, lager poured over the back of a spoon ([Craft Beering](https://www.craftbeering.com/snakebite-drink-beer-cider/)) |
| Baby Guinness | Irish cream floated over coffee liqueur to make the miniature pint's head ([Wikipedia](https://en.wikipedia.org/wiki/Baby_Guinness)) |

The Baby Guinness is the one place the float rule bends, and deliberately. Its
cream is written as a float and behaves as one, but it also stays put as its own
unmixed band, and that band is the entire drink — the head on the miniature
pint. Compare the Buttery Nipple and Slippery Nipple, identical in shape and
already `Layered`. A float that is the point of the drink is a layer.

## Shaken

Dairy the shake rule misses, because it looks for *heavy* cream and
half-and-half rather than plain milk or cream.

| Drink | Source |
|---|---|
| Brandy Milk Punch | Shaken hard with ice and strained ([Saveur](https://www.saveur.com/article/recipes/brennans-brandy-milk-punch-recipe/)) |
| Toasted Almond | Shaken to chill and froth the dairy |
| Long Beach Iced Tea | The Long Island is shaken and its three siblings are built, for no reason but the data: only the Long Island writes a simple syrup into its ingredients, and the sour rule needs both citrus and a sweetener. The sweetness here is in the curaçao and the cranberry, but the drink is the same drink |
| Tokyo Tea | As above, sweetened with Midori |
| Adios Motherfucker | As above, sweetened with blue curaçao |

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
| Boilermaker | Dropped | The same [bomb shot](https://en.wikipedia.org/wiki/Bomb_shot), whiskey into beer. Its ingredient string used to hedge "alongside or dropped"; the alongside form is a `Chased` drink, so the data now names one |
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

A float is never what makes a drink `Layered`. It marks something set on top of
a finished drink, and the method describes what is underneath: a True Blood is
`Built, Not Stirred` with its wine floated on, a Mai Tai is `Shaken` with its
dark rum floated on. Only a drink whose every component is a layer, like a B-52
or a Black Velvet, is poured over the back of a spoon — and the Baby Guinness,
where the float and the layer are the same act.

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

## Muddling

Three things are pressed rather than poured, and each wants different words —
the instruction that dissolves sugar will destroy mint.

| What | Instruction | Drinks |
|---|---|---|
| Sugar alone | muddle until the sugar dissolves | Old Fashioned, Champagne Cocktail |
| Leaf herbs | press gently to release the oils, without shredding the leaves | Mojito ×2, Mint Julep, Queen's Park Swizzle, Southside, Old Cuban, Whiskey Smash, Gin Basil Smash, Gin-Gin Mule |
| Pressed fruit | muddle firmly, until the sugar dissolves and the fruit gives up its juice and oils | Caipirinha, Caipiroska |

**Mint and basil are always muddled**, in a shaken drink as much as a built one,
so the shake branch presses them in the tin before the ice goes in. The test
runs against the *parsed* ingredient, never the raw string, which is what keeps
it off the eight drinks carrying a mint sprig or a lime wedge as a garnish — a
Moscow Mule, a Pimm's Cup, a Jack & Coke. `parseIngredients()` has already put
those in the garnish bucket.

**Muddled fruit is a narrow rule, not a lime rule.** It matches only "Lime (cut
into wedges)" and "Disc of Lime". Muddling a lime is irregular — it is the
Caipirinha family and nothing else — and a general rule would reach every
highball with a wedge on the rim.

Two drinks changed in ways worth recording. The Caipirinha and Caipiroska used
to write their method into the ingredient line ("2 tsp Sugar — muddle lime and
sugar"), which then rendered on the card as an ingredient and left the lime to
be poured in after the ice; the steps say it properly now and the line is just
sugar. And the Ti' Punch no longer muddles: its disc of lime is unmeasured and
parses as a garnish, so the old rule matched "disc of lime" in the raw string
and then muddled the cane syrup by itself, which is not a thing you can do.

## Known gaps

- The build branch reads "hot" off the ingredient text, so a drink whose name
  contains a hot-sounding ingredient other than hot sauce could still be sent to
  a preheated glass.
- The sour rule needs citrus *and* a sweetener named in the ingredients, so a
  drink sweetened only by a liqueur reads as unsweetened. That is why the three
  Iced Teas need overrides their Long Island sibling does not.
- Other unmeasured parts still land in the garnish bucket where they are really
  ingredients or instructions: a Whiskey Sour's bare "Angostura Bitters", a Mint
  Julep's "Crushed Ice", a Carajillo's "layer espresso on top", a Ti' Punch's
  "Small Disc of Lime" — which is squeezed into the drink, not hung on the rim.
  Each needs a decision about what the data should say, not a parser rule.
- "Julep Tin or Rocks" and "Punch Cup or Rocks" read as "a julep tin or rocks",
  because the vessel-noun suppression fires on the first alternative.

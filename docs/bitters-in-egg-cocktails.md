# Bitters in the egg cocktails

Verification pass over every drink in `cocktails.json` whose ingredients contain
egg, checking each against reference guides for one question: do bitters belong,
and if so, are they shaken in or dashed onto the foam?

The distinction is not cosmetic here. `parseIngredients` in `src/recipe-meta.js`
routes any component tagged `(garnish)` out of the build sequence, so an
untagged bitters entry tells the quiz to shake it into the drink. For an
egg-white sour that is usually the wrong instruction: the bitters go on top of
the finished foam, where the aroma sits under the drinker's nose.

## The guides genuinely disagree about sours

There is no single correct answer to inherit. For the whiskey sour alone:

- **The IBA omits bitters entirely** — `45 ml Bourbon Whiskey, 25 ml Fresh Lemon
  Juice, 20 ml Sugar Syrup, Few Drops of Egg White (Optional)`, garnished with
  orange slice and cherry.
- **Difford's shakes them in**, listing `3 dash Angostura Aromatic Bitters`
  among the ingredients, alongside egg white. The Whisky Exchange's whisky sour
  does the same.
- **A great many bar recipes dash them on the foam** as an aromatic garnish.

Our entries take the third position. That is defensible and it is what the
`(garnish)` tag encodes, but it is a house choice rather than a spec we are
matching, and it is worth knowing that the most-cited written guide puts the
bitters *in* the drink.

The Pisco Sour is the one case where bitters-on-foam is unambiguously canonical:
the IBA lists `Few dashes of Amargo bitters on top as an aromatic garnish`, and
the bitters are absent from the shaking step.

## Findings

| Cocktail | Verdict | Notes |
| --- | --- | --- |
| Pisco Sour (Peruvian) | **fixed** | Amargo Chuncho was untagged and shook into the drink. Now `(garnish)`. |
| Pisco Sour | garnish ✓ | IBA calls for Amargo; Angostura is the usual substitute. |
| Whiskey Sour | garnish — house choice | See above. Not in the IBA spec; Difford's shakes it in. |
| Scotch Sour | garnish — house choice | Same divergence; Whisky Exchange shakes in 3 dashes. |
| Mezcal Sour | none ✓ | Mezcal, lemon, agave, egg white is the common published form, and it carries no bitters. |
| Amaretto Sour | none ✓ | Morgenthaler formula: amaretto, cask-strength bourbon, lemon, syrup, egg white. |
| Clover Club | none ✓ | Gin, lemon, raspberry syrup, egg white. |
| Clover Leaf | none ✓ | Craddock: "the same as Clover Club, with a sprig of fresh Mint on top." |
| New York Sour | **added** | Two dashes, tagged as a garnish. Difford's shakes in one; see below. |
| Midori Sour | none ✓ | Midori, lemon, lime, egg white. |
| Pink Lady | none ✓ | Gin, applejack, lemon, grenadine, egg white. |
| White Lady | none ✓ | Craddock is gin, triple sec, lemon; orange bitters only as a suggested variation. |
| Millionaire | none ✓ | Bourbon, curaçao, lemon, grenadine, egg white, absinthe. |
| Ramos Gin Fizz | none ✓ | Orange flower water carries the aromatics, not bitters. |
| Silver Fizz | none ✓ | Gin Fizz plus egg white. |
| Brandy Flip | none ✓ | Whole egg, sugar, brandy, nutmeg. |
| Sherry Flip | none ✓ | Bitters appear only in the modern Fino Flip variant. |
| Porto Flip | none ✓ | |
| Eggnog | none ✓ | Bitters only in variants such as the Jamaican eggnog. |

## On the New York Sour

Two dashes of Angostura, added at Steve's request and tagged `(garnish)` so
they land on the foam after the wine float rather than going into the shaker.

The sourcing is worth stating precisely, because it cuts the same way as the
whiskey sour above. Difford's does call for Angostura in a New York Sour, but as
`1 dash` shaken in with the bourbon and lemon, not dashed on top. The
two-dashes-on-the-foam finish comes from the recipe writers who treat the drink
as an egg-white sour and garnish it the way they garnish the rest. Our entry
follows that second practice, consistent with how the Whiskey Sour, Scotch Sour
and both Pisco Sours are already written here.

## On the Mezcal Sour

Worth recording, because a first pass got this wrong. Our build — mezcal, lemon,
agave, egg white — looked like an outlier beside a pineapple-and-lime recipe
carrying Angostura, and was nearly filed as a divergence. It is not. Mezcal,
lemon, agave and egg white is the ordinary published form of the drink, and the
sources giving it agree in carrying no bitters at all. The pineapple version is
the variant, not the standard. Our entry is right as written.

The recipe has no cited source in this repo. It arrived in `65abc2d`, the
initial commit, among 201 recipes added under the message "done", and nothing
was recorded about where any of them came from. The check above is the first
time it has been held against a reference.

## Noticed while reading the specs, out of scope for bitters

- **Porto Flip** — the IBA builds it on egg *yolk*, not the whole egg we call for.
- **Pink Lady** — the classic includes applejack alongside the gin; ours omits it.
- **White Lady** — early MacElhone and Craddock recipes have no egg white at all.

## Sources

- [IBA — Whiskey Sour](https://iba-world.com/iba-cocktail/whiskey-sour/)
- [IBA — Pisco Sour](https://iba-world.com/iba-cocktail/pisco-sour/)
- [Wikipedia — Pisco sour](https://en.wikipedia.org/wiki/Pisco_sour)
- [Difford's Guide — Whiskey Sour (Difford's recipe)](https://www.diffordsguide.com/cocktails/recipe/2083/whiskey-sour-diffords-recipe)
- [The Whisky Exchange — Whisky Sour](https://www.thewhiskyexchange.com/cocktails/31/whisky-sour)
- [Difford's Guide — Amaretto Sour (Morgenthaler)](https://www.diffordsguide.com/cocktails/recipe/3263/amaretto-sour-by-jeffrey-morgenthaler)
- [Difford's Guide — New York Sour](https://www.diffordsguide.com/cocktails/recipe/3398/new-york-sour)
- [Difford's Guide — Ramos Gin Fizz](https://www.diffordsguide.com/cocktails/recipe/1628/ramos-gin-fizz)
- [Difford's Guide — Flip cocktails](https://www.diffordsguide.com/encyclopedia/1584/cocktails/flip-cocktails)
- [Wikipedia — Clover Club cocktail](https://en.wikipedia.org/wiki/Clover_Club_cocktail)
- [Wikipedia — White lady](https://en.wikipedia.org/wiki/White_lady_(cocktail))
- [Wikipedia — Pink lady](https://en.wikipedia.org/wiki/Pink_lady_(cocktail))
- [PUNCH — Brandy Flip](https://punchdrink.com/recipes/brandy-flip/)
- [A Couple Cooks — Midori Sour](https://www.acouplecooks.com/midori-sour/)
- [The Endless Meal — Mezcal Sour](https://www.theendlessmeal.com/mezcal-sour/)
- [Difford's Guide — Mezcal Sour](https://www.diffordsguide.com/cocktails/recipe/8253/mezcal-sour)
- [Fat Baby Bourbon — Millionaire](https://fatbabybourbon.com/blogs/recipe/millionaire)

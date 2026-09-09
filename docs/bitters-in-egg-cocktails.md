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
| Mezcal Sour | none — diverges | Common recipes shake in 2 dashes Angostura *and* drop more on top. Ours has neither. Left alone; see below. |
| Amaretto Sour | none ✓ | Morgenthaler formula: amaretto, cask-strength bourbon, lemon, syrup, egg white. |
| Clover Club | none ✓ | Gin, lemon, raspberry syrup, egg white. |
| Clover Leaf | none ✓ | Craddock: "the same as Clover Club, with a sprig of fresh Mint on top." |
| New York Sour | none — see below | |
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

## Left alone deliberately

**New York Sour.** Difford's and Imbibe both finish it with two dashes of
Angostura on the egg-white foam. But those same sources note egg white is not
classical in this drink at all, and our entry already departs from the IBA spec
by including it. Adding bitters on top of that stacks one modern reading on
another.

**Mezcal Sour.** The widely published version is mezcal, pineapple, lime, simple
syrup, egg white and Angostura. Ours is mezcal, lemon, agave, egg white — a
different drink, not a version of that one missing its bitters. Changing the
bitters alone would be the wrong half of the fix.

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
- [The Sage Apron — Mezcal Sour](https://thesageapron.com/mezcal-sour/)
- [Fat Baby Bourbon — Millionaire](https://fatbabybourbon.com/blogs/recipe/millionaire)

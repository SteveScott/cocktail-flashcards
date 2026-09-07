# Play Store listing copy

The text of the Google Play listing, kept here so it is versioned and reviewed
like the rest of the app. Paste each block into Play Console → **Grow → Store
presence → Main store listing**.

Play's fields are plain text. The full description renders line breaks but **not**
Markdown, so the blocks below carry no markup and are copied verbatim — including
the paragraphs that run as single long lines. Do not re-wrap them: Play preserves
every newline, and hard-wrapped copy renders as ragged mid-sentence breaks on a
phone.

Limits are 30 characters for the app name, 80 for the short description, 4000 for
the full one; the counts below are current. Re-check after any edit — `wc -m` on
the block, minus its trailing newline.

Two rules the copy follows deliberately:

- **Every claim is checkable in the app.** The mastery threshold, the deck and
  quiz lengths, the price and what Pro carries all come from
  `src/cocktails.json` and `src/App.jsx`. When those change, this file changes
  with them.
- **The collection sizes are floors, not counts.** "320+" for the whole book and
  "270+" for what Pro adds, so shipping a new recipe does not silently make the
  listing wrong. `src/cocktails.json` holds 321 as of this writing (50 free +
  271 Pro); raise each floor to the next round number once the collection passes
  it, and never above the real total. The free tier is the top 50 and is a fixed
  list rather than a running total, so that one is stated outright.
- **No ranking or endorsement claims.** No "best", no "#1", no "as featured in",
  no invented testimonials — Play's metadata policy prohibits them, and there are
  no real numbers to cite yet anyway. The one external reference, Drinks
  International's Bestselling Classics list, is the actual source of the top 50
  (`src/cocktails.json`), not a badge.

---

## App name — 19 / 30

```
Cocktail Flashcards
```

## Short description — 79 / 80

```
Learn 320+ classic cocktail recipes by heart with flashcards and drill quizzes.
```

## Full description — 2,979 / 4000

```
Bar guides tell you what is in a drink. Flashcards make you remember it.

Cocktail Flashcards drills the ingredients, ratios, glassware and serve of 320+ classic cocktails — the Drinks International Bestselling Classics list, plus the deeper cuts a back bar eventually gets asked for — until you can call them from memory in the middle of a Friday night rush.

FOUR WAYS TO PRACTICE

Study Mode
A working deck of 10, 20, 30, 50 or every card. Read the name, recall the spec, reveal, and grade yourself. Right answers push a card's score up, misses pull it back down, and at six it is learned: it leaves the deck and a new drink takes its place. Card colours track the score, so one glance separates solid from shaky.

Self Quiz — Test Yourself
Pick a length, get a fresh shuffle of the whole book, and mark yourself honestly. Ends with your score, the list of what you missed, and a retry that runs the same round again.

86 It — Spot the Impostors
Every ingredient in the drink, plus one to three that have no business being there, all checked. Uncheck the fakes. This one grades itself: right only when every real ingredient survives and every impostor is gone. The impostors are drawn from every ingredient in the collection, so a Margarita can be sabotaged with anything on the shelf.

Index — Search Cocktails
Search all 320+ recipes by name, accent-insensitive, so "pina" finds the Piña Colada. Read any spec and add drinks straight to your deck.

KEEP TRACK OF WHAT YOU HAVE TRIED

Mark a drink as tried, from its card or from the index, and the app remembers. Filter the list down to the ones you have had, or the ones you have not, and pick your next round from there. It is a separate tally from studying: you can have drunk a Vesper without ever putting it in your deck, and learning one does not tick it off for you.

YOUR PROGRESS GOES WITH YOU

Nothing to sign up for — open it and start. Lose the signal on the subway and it keeps going, because your cards are already on the phone, and everything you get right down there is still there when you come back up.

Sign in with Google and your progress follows you between the app and the website. Run through a few on your phone at the bar, sit down at a laptop at home, and the same deck, the same scores and the same tried list are waiting.

FREE, AND PRO

Free: the top 50 bestselling classics in Study Mode and both quizzes, the full index of 320+ recipes to read and search, supported by ads.

Cocktail Flashcards Pro — $7.99, paid once, not a subscription: adds all 270+ cocktails to Study Mode and both quizzes, and removes the ads. Buy it in the app and it works on the website too under the same Google account, and it restores on a new device.

Built for bartenders learning a new menu, barbacks working toward the well, home hosts, and anyone tired of looking up the Last Word for the fourth time.

Recipes are provided for reference and study. Please drink responsibly — for adults of legal drinking age.
```

---

## The rest of the listing

| Field | Value |
|---|---|
| Privacy policy URL | `https://cocktailflashcards.com/privacy` (`public/privacy.html`) |
| Feature graphic | `src/assets/google-play-store-banner.jpg` |
| Phone screenshots | `src/assets/play-store-screenshots/` |
| Contains ads | Yes — AdMob banner in the Play build (`src/monetization.js`) |
| In-app purchases | Yes — one item, $7.99 (`cocktail_flashcards_pro`) |

Category is Education. The alcohol references are declared through the content
rating questionnaire rather than the description. See
[mobile-monetization.md](mobile-monetization.md) for the release process this
listing is part of.

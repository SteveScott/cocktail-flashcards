# Backup and restore

Progress and purchases live in `users/{uid}`. This is how they stay recoverable
without ever downloading or uploading anything, and how to restore one account
— or every account — to its best known state.

## Two durable copies, not a file

There is no backup file, and nothing to download. Every account's best progress
and every purchase already exist a second time, live, in Firestore:

| Collection | Holds | Written by | Can only |
|---|---|---|---|
| `users/{uid}` | current state | the app, every save; the webhooks, every entitlement change | — |
| `highWater/{uid}` | progress at its **best ever** | the app, every save | **grow** |
| `purchaseLedger/{uid}` | purchase fields, mirrored | the webhooks, every entitlement change | reflect the truth |

A restore reads the second and third and merges them into the first. The
instant a cocktail is mastered or a purchase completes, it is already backed
up — there is no export step, no schedule, no window between a backup and an
accident for something to fall through.

### `highWater/{uid}` — the progress mark

The app raises this on every save (`App.jsx → saveHighWater`) using
`mergeProgress` — the same union-and-max rule `App.jsx → mergeStates()` uses to
fold one device's progress into an account. `firestore.rules` enforces that it
can only grow: a write dropping a learned cocktail, a tried mark, a scored
cocktail, or master mode is rejected outright, which is exactly the shape of
bug that used to empty accounts. (`active` is deliberately not checked — it is
the one list that legitimately shrinks, when a cocktail is mastered.)

It is **progress only**. A restore pushes this document back into `users/{uid}`,
and it is client-written — so if an entitlement could ride along in it, any
user could grant themselves Pro by writing `adsRemoved: true` to their own mark
and waiting for a restore. `firestore.rules` allows only `progress` and
`updatedAt`, as a whitelist rather than a denylist, so a field added later is
refused by default rather than silently allowed.

### `purchaseLedger/{uid}` — the purchase mirror

`setSourceEntitlement` (`_entitlements.mjs`) writes the identical purchase
fields to `users/{uid}` **and** `purchaseLedger/{uid}` in the same transaction,
every time a purchase, refund, or transfer happens. The two can never drift
apart in normal operation.

This is what makes "purchase history should never be lost" true even in the
worst case: `users/{uid}` is not a document only a rare event touches — it also
carries progress, written on every study session — so a bug or a slip that
damages it takes the purchase down too, with nothing to recover from, unless
something else holds an independent copy. `purchaseLedger/{uid}` is that copy.

No client can reach it in either direction — not a `get`, not a `list`, nothing.
`firestore.rules` denies it outright, explicitly, rather than leaving it to the
catch-all at the bottom of the file: a collection this security-sensitive
should never look like an oversight. Only the Admin SDK — the webhooks, and the
restore endpoint — ever touches it.

**Accounts that bought Pro before this collection existed** have nothing here
yet, and won't until their next entitlement event (a refund, a restore, a
replatform). Run `npm run backfill-purchase-ledger -- --apply` once to seed it
for every existing purchaser from their current `users/{uid}` fields. Safe to
run more than once — it skips any account that already has an entry.

## The one invariant

**A restore only ever adds.** No field is deleted, no score goes down, no
entitlement is revoked, no user disappears. Everything follows from that:

- Safe against the live database. No downtime, no maintenance window.
- Safe to run twice. An interrupted restore is simply run again.
- Safe even when `highWater` or `purchaseLedger` is behind `users/{uid}` in some
  way nobody anticipated — the worst either can do is nothing.

`mergeProgress` is a least-upper-bound — commutative, associative, idempotent —
which is what lets it be applied repeatedly, in any order, and always land in
the same place. `npm test` holds it to that.

## Who can do it

`VITE_ADMIN_EMAILS`, set in the Netlify site's environment. One list, read in
two places: the client, to decide whether to draw the admin panel, and
`_adminAuth.mjs`, to decide who may actually call the restore endpoint. Netlify
hands every site variable to a function whatever its name — the `VITE_` prefix
only governs what Vite inlines into the browser bundle.

A caller must present a valid Firebase ID token, for an account with a
**verified** email, on that list. The same three conditions `firestore.rules`
applies in `isAdmin()`, mirrored on purpose: the Admin SDK does not run the
rules, so this check is the only one there is. If the variable is empty the
restore endpoint refuses to run — a deploy that forgets it fails closed.

**The list being in the client bundle costs nothing.** It is not a credential
and never was doing the work: an address only matters to someone already
holding a Firebase ID token minted for it, and those are signed by Google and
verified here against Firebase's public keys. Reading the list tells an
attacker whose account to go after — which `firestore.rules` already tells
them, since its `admins()` carries the same addresses in plaintext. What it
does not give them is any way to be that person.

The one thing to watch is the reverse: this variable and the `admins()` list in
`firestore.rules` are separate and must be kept in step by hand. This one gates
the restore endpoint; that one gates ad-whitelist writes.

## How a restore merges

### Progress — union, and the higher of the two

| Field | Rule |
| --- | --- |
| `scores` | per cocktail, `max(live, highWater)` |
| `learned` | set union |
| `tried` | set union |
| `active` | set union, minus anything now in `learned` |
| `masterMode` | `live OR highWater` |
| `deckSize` | live wins — a current preference, not progress; `highWater` only fills a blank |

Lists come out sorted, so the result depends only on what the two sides hold
and not on which was merged first — without that, two devices raising the same
mark from different states would produce documents equal in content but
unequal to any comparison, and each would answer the other's write forever.

`active` is left untrimmed. Only the client knows which cocktails the pool
currently covers — the free top 50, or the whole book with Pro — and its
`refillDeck()` cuts the deck back to size on the next load. Trimming
server-side would mean guessing, and guessing low loses a card someone was
studying.

### Purchases — monotonic, never lowered

**A purchase can be restored. It can never be revoked.**

- `adsRemovedStripe` = `live OR ledger`
- `adsRemovedPlay` = `live OR ledger`
- `adsRemoved` = recomputed as the union of those two, never taken as-is from
  either side
- `adsRemovedAt` = the **earliest** grant either copy knows about, so someone
  Pro since March is not restamped as Pro since today
- `stripeSessionId`, `revenueCatEventId`, `adsRemovedSource` = live value wins;
  the ledger only fills a blank, so a current reference is never replaced by a
  superseded one

Two cases fall out, and both are the point:

- Someone bought Pro **after** the ledger last matched `users/{uid}`. A restore
  does not take it away.
- `users/{uid}` was **damaged or destroyed**. A restore gives the purchase back
  from the ledger, even if the whole document is gone.

A refund or an expiry is the webhooks' business (`setSourceEntitlement`), never
a restore's.

Documents written before the per-source split — `adsRemoved: true` with no
source flags — are read as legacy Stripe grants using the very same `readFlag`
the entitlement code uses. It is imported rather than copied: a second,
drifting copy would quietly revoke ad removal from everyone who bought on the
web before the split.

## Restoring

Menu → **🛟 Restore Progress (admin)**.

- Put an account's **email address or uid** in the box to restore just them —
  the case that actually comes up, when someone writes in having lost their
  progress. Matching on email means support never has to ask for a uid nobody
  knows; it is resolved through Firebase Auth (`getUserByEmail`), not guessed
  from anything client-supplied.
- Leave it blank to restore **every** account. The server pages through
  `users/{uid}` 100 at a time, ordered by document id, and the client
  (`src/admin-restore.js`) follows the cursor automatically.

**Preview** reads and compares and writes nothing — do this first. **Restore**
does it. Each account is written in its own transaction, for the same reason
`setSourceEntitlement` uses one: the webhooks write to these documents at
unpredictable moments, and a read-modify-write without a transaction could drop
a purchase that landed mid-restore.

Restored documents carry `restoredAt`, `restoredBy` and `restoredFrom` as an
audit trail. They are server-owned; no client can write or clear them.

## Account deletion

`delete-account.mjs` removes `highWater/{uid}` and `purchaseLedger/{uid}`
alongside `users/{uid}`. It has to: both are second copies of data this
endpoint exists to erase, and leaving either behind would let a later restore
bring it straight back.

## Tests

```
npm test
```

`_backup.test.mjs` covers the rules directly — that the mark cannot be walked
backwards by a wipe, that `growsFrom` catches every kind of shrink, that the
merge is commutative, associative and idempotent, that a purchase can never be
revoked, and that a legacy grant survives.

`_restore.e2e.test.mjs` drives the real client half against a fake Firestore of
250 accounts — enough that the server's cursor paging engages — with no file
anywhere in it: an account peaks and is wiped and is restored straight from
what was already there; a `users/{uid}` document is deleted outright and its
purchase comes back from the ledger alone; a purchase made after the last
restore survives running it again; one account is restored by the email
address it wrote in from; an unknown email is rejected.

## What this is not

Point-in-time recovery. `highWater` and `purchaseLedger` hold the best and the
true, not a history — they cannot show what an account looked like last March,
only its peak and its current entitlement. If you need that, enable Firestore
PITR in the Firebase console; it is separate, always on, and does not replace
this.

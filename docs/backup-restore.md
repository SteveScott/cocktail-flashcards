# Backup and restore

Progress and purchases live in one Firestore document per user, `users/{uid}`.
This is how to take a copy of all of them, and how to put one back — for
everybody after an accident, or for one person who has written in.

## One file, one row per user, at their best

The backup is **not** a snapshot of a moment, and its date does not matter.

Every account carries a **high-water mark** in `highWater/{uid}`: the same
progress as the live document, under a different rule — it only ever grows. The
app raises it on every save (`App.jsx → saveHighWater`), `firestore.rules`
refuses any write that would lower it, and the export reads *those* rather than
the live documents.

So the file holds each account at its **maximum completed state**, whenever you
happen to download it:

| | `users/{uid}` | `highWater/{uid}` |
|---|---|---|
| Holds | the current state | the best state ever reached |
| On a reset or a wipe | follows it down | unmoved |
| Written by | the app, every save | the app, every save |
| May contain | progress **and** purchases | progress only, enforced by rules |

Someone peaks on Monday, is wiped on Tuesday, and you download on Wednesday —
the file still carries Monday's peak, because Tuesday could not lower it. There
is nothing to schedule, no window to miss, and no reason to keep old files: each
download supersedes the last.

What it is not is point-in-time recovery. It cannot show you what an account
looked like last March, only the best it has ever been. If you need history,
enable Firestore PITR in the Firebase console; it is separate, always on, and
does not replace this.

## The one invariant

**A restore only ever adds.** No field is deleted, no score goes down, no
entitlement is revoked, no user disappears. Everything else follows:

- It is safe against the live database. No downtime, no maintenance window.
- It is safe to run twice. A restore that failed halfway is just re-run.
- It is safe to run from an old file. The worst it can do is nothing.

`mergeProgress` is a least-upper-bound — commutative, associative, idempotent —
which is what lets it be applied repeatedly, in any order, from any device, and
always land in the same place. `npm test` holds it to that.

## Why progress and purchases come from different documents

The mark is **client-written**, and a restore pushes it back into `users/{uid}`.
If an entitlement could ride along in it, any user could grant themselves Pro by
writing `adsRemoved: true` to their own mark and waiting for a restore.

So `highWater/{uid}` carries **progress only** — `firestore.rules` allows
`progress` and `updatedAt` and nothing else, as a whitelist rather than a
denylist, so a field added later is refused by default. Purchases are read from
`users/{uid}`, which no client can write, and merged under their own rule below.

That is why the file has two blocks per user rather than one flat document: they
come from different places and are trusted differently, and putting that in the
data keeps it from living only in the code.

## Who can do it

`ADMIN_EMAILS` — a server-only variable, set in the Netlify site's environment.
Not `VITE_ADMIN_EMAILS`, which is compiled into the bundle every visitor
downloads and only decides whether the admin panel is drawn.

A caller must present a valid Firebase ID token, for an account with a
**verified** email, on that list. The same three conditions `firestore.rules`
applies in `isAdmin()`, mirrored on purpose: the Admin SDK does not run the
rules, so this check is the only one there is. If `ADMIN_EMAILS` is empty both
endpoints refuse to run — a deploy that forgets it fails closed.

## Taking a backup

Menu → **💾 Backup & Restore (admin)** → **Download backup**.

Paged 100 accounts at a time (a function response is capped at a few megabytes;
the file is not) and stitched back together in the browser as
`cocktail-flashcards-backup-<timestamp>.json`.

Keep it somewhere that is not the Firebase project. A backup that lives in the
thing it is backing up is not a backup.

## The file

```json
{
  "format": "cocktail-flashcards/backup",
  "version": 2,
  "createdAt": "2026-09-08T13:04:11.912Z",
  "projectId": "cocktail-flashcards",
  "counts": { "users": 412, "adWhitelist": 3 },
  "users": [
    {
      "uid": "V1cVv…",
      "email": "drinker@example.com",
      "updatedAt": 1757340000000,

      "purchase": {
        "adsRemoved": true,
        "adsRemovedStripe": true,
        "adsRemovedPlay": false,
        "adsRemovedAt": 1756000000000,
        "adsRemovedSource": "stripe",
        "stripeSessionId": "cs_…",
        "revenueCatEventId": null
      },

      "progress": {
        "scores": { "Negroni": 6, "Sidecar": 2 },
        "learned": ["Negroni"],
        "tried": ["Negroni", "Sazerac"],
        "active": ["Martini", "Sidecar"],
        "masterMode": true,
        "deckSize": 20
      }
    }
  ],
  "adWhitelist": [
    { "email": "comped@example.com", "addedAt": 1756000000000, "addedBy": "steve@…" }
  ]
}
```

`createdAt` is when the file was downloaded. It is not what the file holds —
that is each account's peak, regardless of date.

A `version: 1` file (a point-in-time snapshot, from before high-water marks)
still restores: the merge treats whatever it holds as one more lower bound.

## How a restore merges

### Progress — union, and the higher of the two

| Field | Rule |
| --- | --- |
| `scores` | per cocktail, `max(live, backup)` |
| `learned` | set union |
| `tried` | set union |
| `active` | set union, minus anything now in `learned` |
| `masterMode` | `live OR backup` |
| `deckSize` | live wins — a current preference, not progress; the backup only fills a blank |

Lists come out sorted, so the result depends only on what the two sides hold and
not on which was merged first. Without that, two devices raising the same mark
produce documents equal in content but unequal to any comparison, and each then
answers the other's write forever.

`active` is left untrimmed. Only the client knows which cocktails the pool
currently covers — the free top 50, or the whole book with Pro — and its
`refillDeck()` cuts the deck back to size on the next load. Trimming server-side
would mean guessing, and guessing low loses a card someone was studying.

### Purchases — monotonic, never lowered

**A purchase can be restored. It can never be revoked.**

- `adsRemovedStripe` = `live OR backup`
- `adsRemovedPlay` = `live OR backup`
- `adsRemoved` = recomputed as the union of those two, never taken from the file
- `adsRemovedAt` = the **earliest** grant either copy knows about, so someone Pro
  since March is not restamped as Pro since today
- `stripeSessionId`, `revenueCatEventId`, `adsRemovedSource` = live value wins;
  the backup only fills a blank, so a current reference is never replaced by a
  superseded one

Two cases fall out, and both are the point:

- Someone bought Pro **after** the file was downloaded. Restoring does not take
  it away.
- Someone's record was **destroyed**. Restoring gives it back.

A refund or an expiry is the webhooks' business (`_entitlements.mjs`), never a
restore's.

Documents written before the per-source split — `adsRemoved: true` with no
source flags — are read as legacy Stripe grants using the very same `readFlag`
the entitlement code uses. It is imported rather than copied: a second, drifting
copy would quietly revoke ad removal from everyone who bought on the web before
the split.

### The ad whitelist

Restored on a full run only, and only where an entry is missing. Never deleted.
Losing it puts ads back for people who were promised none.

## Restoring

Menu → **💾 Backup & Restore (admin)** → choose the file.

- **Preview** reads and compares and writes nothing. Do this first. It reports
  exactly what would change.
- **Restore** does it.

Each user is written in its own transaction, for the same reason
`setSourceEntitlement` uses one: the Stripe and RevenueCat webhooks write to
these documents at unpredictable moments, and a read-modify-write without a
transaction could drop a purchase that landed mid-restore.

Restored documents carry `restoredAt`, `restoredBy` and `restoredFrom` as an
audit trail. They are server-owned; no client can write or clear them.

### One person

Put their **email address or uid** in the box before pressing Preview or
Restore. Blank restores everyone.

This is the case that actually comes up: someone writes in having lost their
progress, and you restore only them. Matching on email means support never has
to ask for a uid nobody knows.

## Accounts that predate high-water marks

An account that has not saved since this shipped has no mark yet. The export
merges the mark with the live document and takes the best of both, so those
accounts export at their current state and heal to a true high-water mark the
first time they save. No migration, no backfill.

## Account deletion

`delete-account.mjs` removes `highWater/{uid}` alongside `users/{uid}`. It has
to: the mark is a second copy of the same progress, and deleting an account
without it would leave the data behind and let a later restore bring it back.

## Tests

```
npm test
```

`_backup.test.mjs` covers the rules directly — that the mark cannot be walked
backwards by a wipe, that `growsFrom` catches every kind of shrink, that the
merge is commutative, associative and idempotent, that a stale file cannot un-Pro
anyone, that a destroyed record comes back, and that a legacy grant survives.

`_restore.e2e.test.mjs` drives the real client half against a fake Firestore of
250 accounts — enough that paging and chunking both engage — through the case
this design exists for: an account peaks, is wiped the next day, and is
downloaded the day after that. The file carries the peak.

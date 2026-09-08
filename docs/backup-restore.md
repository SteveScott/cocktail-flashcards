# Backup and restore

Progress and purchases live in one Firestore document per user, `users/{uid}`.
This is how to take a copy of all of them, and how to put one back — for
everybody after an accident, or for one person who has written in.

Both halves run as Netlify functions with the Admin SDK, because
`firestore.rules` deliberately forbids any client — an administrator's included
— from listing the users collection (`allow list: if false`) or reading someone
else's document. There is no way to do this from the browser, and there should
not be.

## The one invariant

**A restore only ever adds.** No field is deleted, no score goes down, no
entitlement is revoked, no user disappears. Everything else here follows from
that:

- It is safe against the live database. No downtime, no maintenance window.
- It is safe to run twice. A restore that failed halfway is just re-run.
- It is safe to run from a file **older** than the data already there — which is
  the normal case, since whatever you are repairing happened after the backup
  was taken. The worst a stale file can do is nothing.

It is enforced in `netlify/functions/_backup.mjs` and guarded by `npm test`.

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

The export is paged 100 accounts at a time (a function response is capped at a
few megabytes; the file is not) and the browser stitches the pages into one
file, `cocktail-flashcards-backup-<timestamp>.json`.

Keep them somewhere that is not the Firebase project. A backup that lives in the
thing it is backing up is not a backup.

## The file

```json
{
  "format": "cocktail-flashcards/backup",
  "version": 1,
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
        "active": ["Sidecar", "Martini"],
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

`purchase` and `progress` are separate blocks rather than one flat document
because they are restored under **opposite** rules. Splitting them puts that
difference in the data, where it can be read, instead of only in the code.

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

The same rule `App.jsx → mergeStates()` uses when it folds a device's progress
into an account, for the same reason: having mastered a cocktail is a fact one
copy of the data cannot un-know.

`active` is left as the union rather than trimmed. Only the client knows which
cocktails the pool currently covers — the free top 50, or the whole book with
Pro — and its `refillDeck()` cuts the deck back to size on the next load.
Trimming server-side would mean guessing, and guessing low loses a card someone
was studying.

### Purchases — monotonic, never lowered

**A purchase can be restored. It can never be revoked.** This is the half that
has to be got right, and it is why a restore is a merge rather than an
overwrite.

- `adsRemovedStripe` = `live OR backup`
- `adsRemovedPlay` = `live OR backup`
- `adsRemoved` = recomputed as the union of those two, never taken from the file
- `adsRemovedAt` = the **earliest** grant either copy knows about, so someone Pro
  since March is not restamped as Pro since today
- `stripeSessionId`, `revenueCatEventId`, `adsRemovedSource` = live value wins;
  the backup only fills a blank, so a current reference is never replaced by a
  superseded one

Two cases fall out, and both are the point:

- Someone bought Pro **after** the backup was taken. Restoring the old file does
  not take it away.
- Someone's record was **destroyed**. Restoring gives it back.

A refund or an expiry is the webhooks' business (`_entitlements.mjs`), never a
restore's.

Documents written before the per-source split — `adsRemoved: true` with no
source flags — are read as legacy Stripe grants, using the very same `readFlag`
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
progress, and you restore only them from the most recent backup. Matching on
email means support never has to ask for a uid nobody knows.

## Tests

```
npm test
```

`_backup.test.mjs` covers the merge rules directly — that a stale file cannot
un-Pro anyone, that a destroyed record comes back, that a legacy grant survives,
that no live value ever shrinks, and that merging is idempotent.

`_restore.e2e.test.mjs` drives the real client half against a fake Firestore of
250 accounts, so paging and chunking both engage, through the scenario the
feature exists for: progress wiped and purchases lost across the board, then
restored from a file taken before it.

## What this is not

Point-in-time recovery. These are snapshots you take deliberately; anything
between the last one and an accident is gone. For a real RPO, enable Firestore
PITR in the Firebase console — it is a separate, always-on facility and does not
replace this one. This is for putting a known-good copy back, and for handing
one person their history back on request.

import { getAdmin } from "./_firebaseAdmin.mjs";
import { requireAdmin, errorResponse, HttpError } from "./_adminAuth.mjs";
import { validateBackup, mergeProgress, mergePurchase, describeChange } from "./_backup.mjs";

// Restores a backup into Firestore: everyone in the file, or one person out of
// it when someone writes in having lost their progress.
//
// Every write goes through mergeProgress / mergePurchase, which between them
// hold the one invariant this endpoint is built on: a restore only ever ADDS.
// Nothing is deleted, no score goes down, no entitlement is revoked, no user is
// removed. Three things follow, and all three are the reason it is shaped this
// way rather than as a plain overwrite:
//
//   - it is safe against a live database, so it does not need downtime;
//   - it is safe to run twice, so a half-finished restore is just re-run;
//   - it is safe to run from a file older than the data already there, which is
//     the normal case, since the accident being repaired happened after the
//     backup was taken.
//
// Each user is written in its own transaction, for the same reason
// setSourceEntitlement uses one: the Stripe and RevenueCat webhooks are writing
// to these documents at unpredictable moments, and a read-modify-write without
// one could drop a purchase that landed mid-restore.
const MAX_USERS_PER_CALL = 100;

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  try {
    const admin = await requireAdmin(event);
    const { backup, uid, email, dryRun = false } = JSON.parse(event.body || "{}");
    validateBackup(backup);

    // Restoring one person: pick them out of the file by uid, or by the address
    // they wrote in from. Matching on either means support does not have to ask
    // someone for a uid they have no way of knowing.
    const wanted = (email || "").trim().toLowerCase();
    const targets = (uid || wanted)
      ? backup.users.filter((u) => (uid && u.uid === uid) || (wanted && (u.email || "").toLowerCase() === wanted))
      : backup.users;

    if ((uid || wanted) && targets.length === 0) {
      throw new HttpError(404, "That account is not in this backup file.");
    }
    if (targets.length > MAX_USERS_PER_CALL) {
      throw new HttpError(413, `Send at most ${MAX_USERS_PER_CALL} users per request.`);
    }

    const db = getAdmin().firestore();
    const now = Date.now();
    const results = [];

    for (const entry of targets) {
      if (!entry?.uid) continue;
      const ref = db.collection("users").doc(entry.uid);

      // One transaction per user, sequentially: a failure on one account must
      // not roll back the others, and a restore is not on any hot path.
      const change = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const live = snap.exists ? snap.data() : {};

        const merged = {
          ...mergePurchase(live, entry.purchase || {}),
          progress: mergeProgress(live.progress, entry.progress, entry.uid),
        };
        const delta = describeChange(live, merged);

        // A dry run reads and compares and stops there, so an operator can see
        // what a file would do to the live database before it does it.
        if (dryRun || !delta.changed) return delta;

        tx.set(ref, {
          ...merged,
          updatedAt: now,
          // An audit trail on the document itself: who restored it, when, and
          // from which file. Server-owned, so no client can write or clear it.
          restoredAt: now,
          restoredBy: admin.email,
          restoredFrom: backup.createdAt || null,
        }, { merge: true });
        return delta;
      });

      results.push({ uid: entry.uid, email: entry.email || null, ...change });
    }

    // Comped accounts are part of the picture: losing the whitelist puts ads
    // back for people who were promised none. Created where missing and left
    // alone where present — never deleted, like everything else here.
    let whitelistRestored = 0;
    if (!uid && !wanted && Array.isArray(backup.adWhitelist)) {
      for (const entry of backup.adWhitelist) {
        const id = (entry?.email || "").trim().toLowerCase();
        if (!id) continue;
        const ref = db.collection("adWhitelist").doc(id);
        const snap = await ref.get();
        if (snap.exists) continue;
        whitelistRestored += 1;
        if (!dryRun) await ref.set({ addedAt: entry.addedAt || now, addedBy: entry.addedBy || "restore" });
      }
    }

    const changed = results.filter((r) => r.changed);
    return {
      statusCode: 200,
      body: JSON.stringify({
        dryRun,
        examined: results.length,
        changed: changed.length,
        proRestored: results.filter((r) => r.proRestored).length,
        whitelistRestored,
        // Only the accounts something actually happened to, so the summary of a
        // full restore stays readable.
        details: changed,
      }),
    };
  } catch (e) {
    return errorResponse(e);
  }
}

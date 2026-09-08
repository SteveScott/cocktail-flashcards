import { FieldPath } from "firebase-admin/firestore";
import { getAdmin } from "./_firebaseAdmin.mjs";
import { requireAdmin, errorResponse, HttpError } from "./_adminAuth.mjs";
import { mergeProgress, mergePurchase, describeChange } from "./_backup.mjs";

// Restores accounts to their best known state — one, picked by email or uid, or
// every account — by reading straight out of Firestore. No file changes hands:
// highWater/{uid} and purchaseLedger/{uid} are already durable, already current,
// and already there (see _backup.mjs), so this endpoint is nothing more than
// the merge itself, run server-side against the collection instead of an
// upload.
//
// Every write goes through mergeProgress / mergePurchase, which between them
// hold the one invariant this endpoint is built on: a restore only ever ADDS.
// Nothing is deleted, no score goes down, no entitlement is revoked, no user is
// removed. That is what makes it safe to run against a live database with no
// downtime, and safe to run twice — a restore interrupted partway through (a
// lost connection, a timed-out function) is simply run again.
//
// Each user is written in its own transaction, for the same reason
// setSourceEntitlement uses one: the Stripe and RevenueCat webhooks are writing
// to these documents at unpredictable moments, and a read-modify-write without
// one could drop a purchase that landed mid-restore.
//
// A full restore is paged 100 accounts at a time, ordered by document id, the
// same shape admin-backup.mjs used to page an export — except now the client
// drives the SAME collection directly (src/admin-restore.js loops the cursor),
// rather than paging through an array it downloaded first.
const PAGE_SIZE = 100;

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  try {
    const admin = await requireAdmin(event);
    const { uid, email, cursor, dryRun = false } = JSON.parse(event.body || "{}");
    const db = getAdmin().firestore();

    // Restoring one person, by the uid they were told, or by the address they
    // wrote in from — matching on either means support never has to ask someone
    // for a uid they have no way of knowing.
    const wanted = (email || "").trim().toLowerCase();
    let targetUids;
    let nextCursor;

    if (uid || wanted) {
      let resolved = uid;
      if (!resolved) {
        try {
          resolved = (await getAdmin().auth().getUserByEmail(wanted)).uid;
        } catch {
          throw new HttpError(404, "No account with that email address.");
        }
      }
      targetUids = [resolved];
    } else {
      let query = db.collection("users").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(db.collection("users").doc(cursor));
      const snap = await query.get();
      targetUids = snap.docs.map((d) => d.id);
      if (snap.docs.length === PAGE_SIZE) nextCursor = snap.docs[snap.docs.length - 1].id;
    }

    const now = Date.now();
    const results = [];

    for (const targetUid of targetUids) {
      const ref = db.collection("users").doc(targetUid);
      const hwRef = db.collection("highWater").doc(targetUid);
      const ledgerRef = db.collection("purchaseLedger").doc(targetUid);

      // One transaction per user, sequentially: a failure on one account must
      // not roll back the others, and a restore is not on any hot path.
      const change = await db.runTransaction(async (tx) => {
        const [userSnap, hwSnap, ledgerSnap] = await Promise.all([tx.get(ref), tx.get(hwRef), tx.get(ledgerRef)]);
        const live = userSnap.exists ? userSnap.data() : {};
        const highWater = hwSnap.exists ? hwSnap.data()?.progress : null;
        const ledger = ledgerSnap.exists ? ledgerSnap.data() : {};

        const merged = {
          ...mergePurchase(live, ledger),
          progress: mergeProgress(live.progress, highWater, targetUid),
        };
        const delta = describeChange(live, merged);

        // A dry run reads and compares and stops there, so an operator can see
        // what would change before it does.
        if (dryRun || !delta.changed) return delta;

        tx.set(ref, {
          ...merged,
          updatedAt: now,
          // An audit trail on the document itself: who restored it, when, and
          // from what. Server-owned, so no client can write or clear it.
          restoredAt: now,
          restoredBy: admin.email,
          restoredFrom: "highWater/purchaseLedger",
        }, { merge: true });
        return delta;
      });

      results.push({ uid: targetUid, ...change });
    }

    const changed = results.filter((r) => r.changed);

    // Resolve emails for just the accounts something happened to, so the
    // summary reads as people rather than a column of uids. Only the changed
    // ones — usually a handful — rather than every account examined, which for
    // a full restore can be the whole user base.
    let emails = {};
    if (changed.length) {
      try {
        const result = await getAdmin().auth().getUsers(changed.map((r) => ({ uid: r.uid })));
        emails = Object.fromEntries(result.users.map((u) => [u.uid, u.email || null]));
      } catch (e) {
        console.error("Could not resolve emails for the restore summary", e);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        dryRun,
        examined: results.length,
        changed: changed.length,
        proRestored: results.filter((r) => r.proRestored).length,
        // Only the accounts something actually happened to, so the summary of a
        // full restore stays readable.
        details: changed.map((r) => ({ ...r, email: emails[r.uid] || null })),
        // Absent means this was the last page (or a single-account restore).
        ...(nextCursor ? { nextCursor } : {}),
      }),
    };
  } catch (e) {
    return errorResponse(e);
  }
}

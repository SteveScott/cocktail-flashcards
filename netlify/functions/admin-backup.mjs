import { FieldPath } from "firebase-admin/firestore";
import { getAdmin } from "./_firebaseAdmin.mjs";
import { requireAdmin, errorResponse } from "./_adminAuth.mjs";
import { BACKUP_FORMAT, BACKUP_VERSION, purchaseOf, mergeProgress } from "./_backup.mjs";

// Exports every account at its BEST, and the ad whitelist, as one backup file.
//
// Progress comes from highWater/{uid} — the mark the app raises on every save,
// which can only ever grow — rather than from the live document, which follows
// the current state down. That is the whole reason this file needs no schedule
// and no snapshot: a wipe cannot lower a peak that was already recorded, so a
// download at any later moment still carries it.
//
// Purchases come from users/{uid} instead, and deliberately so. The mark is
// client-written, and a restore pushes it back; an entitlement carried in a
// document its owner can write would be one any user could grant themselves.
//
// This has to run server-side: firestore.rules sets `allow list: if false` on
// users/{uid} precisely so that no client — an administrator's included — can
// enumerate the collection, and reading someone else's document is denied on
// top of that. The Admin SDK bypasses both, which is why _adminAuth.mjs is
// checked first and checked hard.
//
// Paged, and the caller stitches the pages together into one file. A Netlify
// function may return about 6 MB, and a few thousand study decks will pass that;
// paging keeps the export working as the user base grows rather than failing at
// whatever size crosses the line. Ordered by document id so the cursor is
// stable even while documents are being written underneath it.
const PAGE_SIZE = 100; // also auth().getUsers()'s per-call limit, so one call per page

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  try {
    await requireAdmin(event);
    const { cursor } = JSON.parse(event.body || "{}");

    const admin = getAdmin();
    const db = admin.firestore();

    let query = db.collection("users").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(db.collection("users").doc(cursor));
    const snap = await query.get();

    // The marks for this page, in one round trip. A user who has not saved
    // since high-water marks shipped has none yet; their live progress is then
    // the best record there is, and merging the two means the export self-heals
    // as those accounts come back rather than needing a migration.
    let marks = {};
    if (snap.docs.length) {
      const refs = snap.docs.map((d) => db.collection("highWater").doc(d.id));
      const markDocs = await db.getAll(...refs);
      marks = Object.fromEntries(
        markDocs.filter((d) => d.exists).map((d) => [d.id, d.data()?.progress || null])
      );
    }

    // The address is what makes "restore this one person" answerable from a
    // support email, so it is looked up here rather than left to whoever reads
    // the file. It lives in Auth, not Firestore, and a failure to read it is not
    // worth failing an export over — the uid is the key either way.
    let emails = {};
    if (snap.docs.length) {
      try {
        const result = await admin.auth().getUsers(snap.docs.map((d) => ({ uid: d.id })));
        emails = Object.fromEntries(result.users.map((u) => [u.uid, u.email || null]));
      } catch (e) {
        console.error("Could not resolve emails for this page; exporting without them", e);
      }
    }

    const users = snap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        uid: doc.id,
        email: emails[doc.id] || null,
        updatedAt: data.updatedAt || null,
        // Split deliberately: these two halves are restored under opposite
        // rules. See _backup.mjs.
        purchase: purchaseOf(data),
        progress: mergeProgress(marks[doc.id] || null, data.progress || null, doc.id),
      };
    });

    // Only on the first page — it belongs to the file, not to any page of it.
    let adWhitelist;
    if (!cursor) {
      const wl = await db.collection("adWhitelist").get();
      adWhitelist = wl.docs.map((d) => ({ email: d.id, ...d.data() }));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        projectId: process.env.FIREBASE_PROJECT_ID || null,
        users,
        ...(adWhitelist ? { adWhitelist } : {}),
        // Absent means this was the last page.
        ...(snap.docs.length === PAGE_SIZE ? { nextCursor: snap.docs[snap.docs.length - 1].id } : {}),
      }),
    };
  } catch (e) {
    return errorResponse(e);
  }
}

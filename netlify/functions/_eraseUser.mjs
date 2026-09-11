import { getAdmin } from "./_firebaseAdmin.mjs";

// Erasing one person from the system, in one place.
//
// Two endpoints need this and must not drift apart: delete-account.mjs, where
// someone deletes their own account from the app, and admin-erase-user.mjs,
// where an administrator does it on request for someone who wrote in. A wipe
// that reached three collections from one door and four from the other would
// be the worst kind of bug here — nobody would see the difference, and the
// residue would sit in Firestore indefinitely.
//
// ── What has to be deleted, and why all of it ───────────────────────────────
//
// Every account's data exists in up to four places (see _backup.mjs, and the
// `match` blocks in firestore.rules — these are the only collections there):
//
//   users/{uid}            the live state: progress and entitlement flags
//   highWater/{uid}        progress only, and it can only ever GROW
//   purchaseLedger/{uid}   purchase fields only, no client can read it
//   adWhitelist/{email}    keyed by ADDRESS, not uid — see below
//
// Deleting only users/{uid} would not be an erasure at all. The other two exist
// precisely so that progress and purchases survive damage to it, and
// admin-restore.mjs merges them straight back — so a half-wipe is a wipe that
// the next restore undoes. (It does not, today: mergeProgress returns null for
// an account with nothing left anywhere, describeChange reports no change, and
// the restore writes nothing. tests/erase.test.mjs holds that shut, because it
// is a property of those two functions rather than anything a reader of this
// file could see.)
//
// ── Order matters ──────────────────────────────────────────────────────────
//
// Firestore documents first, auth user second. If the auth user went first and
// the Firestore delete then failed, the documents would be orphaned under a uid
// that can never sign in again — unreachable by the person it describes and by
// every self-service path, which is the one outcome an erasure must not produce.
// The reverse order fails safe: a retry deletes what is left, and deleting a
// document that is already gone is a no-op.

const AD_WHITELIST_COLLECTION = "adWhitelist";

// The per-uid collections, in the order they are deleted. Named once so a
// collection added later is added here rather than in two endpoints.
export const UID_COLLECTIONS = ["users", "highWater", "purchaseLedger"];

// What an erasure cannot reach, stated rather than left implied. Returned to
// the caller and shown in the admin UI: the difference between "your data is
// wiped" and "the data this system controls is wiped" is a promise somebody
// makes to a person who asked, and it should not be made on a guess.
export const NOT_REACHED = [
  "Stripe's own customer and payment records, which have their own retention basis",
  "RevenueCat's record of the Play purchase",
  "Netlify's function logs, which retain uids and addresses for their own window",
  "progress saved in the browser on the person's own device, which only they can clear",
  // The one gap that puts data BACK rather than merely leaving some behind, so
  // it belongs in the list a person's answer is written from. Nothing signs the
  // target out: an admin erasure has no client on the other end, unlike
  // delete-account, which calls signOut itself. A device still on the study
  // screen autosaves 800 ms after any change, with merge: true — and a
  // merge-write to a deleted document recreates it. firestore.rules checks
  // request.auth.uid and does not check revocation, so the window lasts as long
  // as that device's existing ID token does.
  "progress an app still open on the person's device may write back while its sign-in token is still valid — look the account up again afterwards, and erase again if anything reappeared",
];

// Same rule as the client's normalizeEmail (src/firebase.js), which is what
// writes these document ids. A mismatch here would leave the whitelist entry
// behind — and an erased address still on the whitelist is exactly the kind of
// quiet residue this module exists to prevent.
export const normalizeEmail = (email) => (email || "").trim().toLowerCase();

// Every address this account could be whitelisted under. The whitelist is keyed
// by address, and an account can hold more than one: the address on the auth
// record, plus whatever each sign-in provider reports. Someone who was
// whitelisted under their Google address and later signed in with a different
// primary would otherwise keep their entry through the wipe.
export function whitelistEmails(userRecord) {
  if (!userRecord) return [];
  const all = [userRecord.email, ...(userRecord.providerData || []).map((p) => p.email)];
  return [...new Set(all.map(normalizeEmail).filter(Boolean))];
}

// Which phase failed, so a caller can tell the two apart: nothing was removed
// (safe to retry, and safe to say so) versus the data is gone but the sign-in
// account survives (a retry is still safe, but the message must not claim
// nothing happened).
export class ErasePhaseError extends Error {
  constructor(phase, cause) {
    super(cause?.message || `Erase failed during the ${phase} phase`);
    this.phase = phase; // "data" | "auth"
    this.cause = cause;
  }
}

// Look the target up without deleting anything: what exists now, and the
// addresses the whitelist would be checked under. Used by the admin endpoint's
// dry run, so an irreversible action aimed at somebody else's account can be
// read before it is taken.
//
// A uid with no auth user is not an error. Records orphaned by an interrupted
// erasure are precisely what someone would come here to clean up, and refusing
// to look at them would make this the one tool that cannot finish its own job.
export async function surveyUser({ uid, email, admin = getAdmin() }) {
  const db = admin.firestore();

  let userRecord = null;
  let resolvedUid = uid;
  if (!resolvedUid) {
    // Resolve by address, the way somebody who wrote in is actually identified
    // — support is never in a position to ask them for a uid.
    userRecord = await admin.auth().getUserByEmail(normalizeEmail(email));
    resolvedUid = userRecord.uid;
  } else {
    try {
      userRecord = await admin.auth().getUser(resolvedUid);
    } catch {
      userRecord = null; // orphaned documents; still erasable below
    }
  }

  const emails = whitelistEmails(userRecord);
  const [docs, whitelistSnaps] = await Promise.all([
    db.getAll(...UID_COLLECTIONS.map((c) => db.collection(c).doc(resolvedUid))),
    Promise.all(emails.map((e) => db.collection(AD_WHITELIST_COLLECTION).doc(e).get())),
  ]);

  return {
    uid: resolvedUid,
    email: userRecord?.email ? normalizeEmail(userRecord.email) : null,
    emails,
    authUser: Boolean(userRecord),
    found: {
      ...Object.fromEntries(UID_COLLECTIONS.map((c, i) => [c, docs[i].exists])),
      adWhitelist: emails.filter((_, i) => whitelistSnaps[i].exists),
    },
  };
}

// Delete the data, then the account. `emails` are the whitelist ids to clear;
// pass every address the account is known by (whitelistEmails above), or the
// token's own address when that is all the caller legitimately has.
//
// One batch for the documents, so a failure leaves the account exactly as it
// was and "nothing was removed" stays a true thing to tell somebody. Deleting
// an absent document is a no-op, so no existence check is needed — most
// accounts have no whitelist entry and many have no ledger.
// The `admin` parameter defaults to the real SDK and is only ever passed by
// tests/erase.test.mjs. The set of collections a wipe reaches, and the order the
// two phases run in, are the whole safety argument for this module — and neither
// is visible from any endpoint that calls it, so both get a regression guard,
// which means something has to be able to stand in for Firestore.
export async function eraseUser({ uid, emails = [], admin = getAdmin() }) {
  const db = admin.firestore();
  const ids = [...new Set(emails.map(normalizeEmail).filter(Boolean))];

  try {
    const batch = db.batch();
    for (const c of UID_COLLECTIONS) batch.delete(db.collection(c).doc(uid));
    for (const id of ids) batch.delete(db.collection(AD_WHITELIST_COLLECTION).doc(id));
    await batch.commit();
  } catch (e) {
    throw new ErasePhaseError("data", e);
  }

  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    // Not found is success: an erasure retried after a partial failure, or an
    // orphaned set of documents whose auth user was already gone. Anything else
    // is a real failure, and the documents are already deleted by now — the
    // caller has to say so rather than imply nothing happened.
    if (e?.code !== "auth/user-not-found") throw new ErasePhaseError("auth", e);
  }

  return { uid, emails: ids, collections: UID_COLLECTIONS };
}

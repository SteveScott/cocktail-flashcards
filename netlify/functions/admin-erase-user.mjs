import { requireAdmin, errorResponse, HttpError, adminEmails } from "./_adminAuth.mjs";
import { surveyUser, eraseUser, NOT_REACHED } from "./_eraseUser.mjs";

// Erases one person on request — the administrator's side of the door
// delete-account.mjs opens for the person themselves.
//
// It exists because the self-service button cannot always be pressed. Somebody
// who has lost access to the address they signed up with, or who signed in
// through a provider they no longer control, or who simply emails asking for
// their data to be deleted, has no way to reach it — and "we can only delete
// your data if you can still sign in" is not an answer to a deletion request.
//
// The wipe itself is _eraseUser.mjs, unchanged and shared, so this endpoint
// cannot quietly remove a different set of things than the in-app button does.
// What is specific to going through an administrator is all here:
//
//   1. requireAdmin — a verified session, a verified address, on the list.
//   2. The target is named by the caller, so it is RESOLVED and reported back
//      before anything happens. Erasure is irreversible and aimed at someone
//      else's account; typing one character wrong should cost a preview, not
//      an account.
//   3. dryRun, the same Preview/Restore idiom admin-restore.mjs already uses.
//   4. Administrators cannot be erased through it (see below).
//
// Deliberately NOT here: Stripe and RevenueCat. Their records of a payment have
// their own retention basis, and cancelling them is a decision to be taken
// deliberately rather than as a side effect of clearing a flag in Firestore.
// NOT_REACHED names them, and every other place this wipe does not go, in the
// response — so whoever answers the request can say what was actually done.

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  try {
    const admin = await requireAdmin(event);
    const { uid, email, dryRun = false } = JSON.parse(event.body || "{}");

    const wanted = (email || "").trim().toLowerCase();
    if (!uid && !wanted) {
      // No "erase everyone". admin-restore.mjs treats a blank target as "all
      // accounts" because a restore can only add; the same blank here would be
      // the whole user base, and there is no version of this feature that
      // should be one empty field away from that.
      throw new HttpError(400, "Name the account to erase, by email address or uid.");
    }

    let target;
    try {
      target = await surveyUser({ uid, email: wanted });
    } catch (e) {
      if (e?.code === "auth/user-not-found" || e?.code === "auth/invalid-email") {
        throw new HttpError(404, "No account with that email address.");
      }
      throw e;
    }

    // An account with no auth user and no documents anywhere is not something
    // to report as erased. Almost always a mistyped uid.
    const anything = target.authUser || Object.values(target.found).some((v) => (Array.isArray(v) ? v.length : v));
    if (!anything) throw new HttpError(404, "Nothing found for that account — no sign-in record and no data.");

    // Administrators are not erasable here. An account on VITE_ADMIN_EMAILS is
    // one of the people who can call this endpoint, and erasing it removes
    // access to the endpoint itself — including, on a one-administrator
    // deployment, the ability to undo the mistake or run a restore afterwards.
    // An administrator leaving is a deliberate act that should go through the
    // env var first, not a typed address away.
    const allowed = adminEmails();
    const isAdminTarget = target.emails.some((e) => allowed.includes(e));
    if (isAdminTarget) {
      throw new HttpError(400, "That account is an administrator. Remove it from VITE_ADMIN_EMAILS first.");
    }

    // A dry run resolves and reads and stops there, so the address and uid can
    // be checked against the request that came in before anything is destroyed.
    if (dryRun) {
      return {
        statusCode: 200,
        body: JSON.stringify({ dryRun: true, erased: false, ...target, notReached: NOT_REACHED }),
      };
    }

    await eraseUser({ uid: target.uid, emails: target.emails });

    // The audit trail. There is no tombstone document — writing a record of the
    // erasure into Firestore would mean keeping the address of somebody who
    // asked to be forgotten, in a collection built to hold it indefinitely — so
    // who did it, to whom and when lives in the function log, which has a
    // retention window of its own and expires.
    console.log("Admin erase:", admin.email, "erased", target.uid, target.email || "(no address)");

    return {
      statusCode: 200,
      body: JSON.stringify({ dryRun: false, erased: true, ...target, notReached: NOT_REACHED }),
    };
  } catch (e) {
    if (e?.phase === "auth") {
      // Data gone, sign-in account still there. Say exactly that: a retry is
      // safe, and the person asking deserves better than a message implying
      // nothing happened when their progress and purchase record are gone.
      console.error("Erased the data but could not delete the auth user", e.cause || e);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "The data was erased, but the sign-in account could not be removed. Run it again." }),
      };
    }
    if (e?.phase === "data") {
      console.error("Failed to erase user data", e.cause || e);
      return { statusCode: 500, body: JSON.stringify({ error: "Could not erase the data. Nothing was removed." }) };
    }
    return errorResponse(e);
  }
}

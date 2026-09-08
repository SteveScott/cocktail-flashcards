// Client half of the admin restore feature. Every decision that matters is made
// on the server (netlify/functions/admin-restore.mjs); this only calls it.
//
// There is no file. Progress and purchases already live durably in Firestore —
// highWater/{uid} and purchaseLedger/{uid} — and the endpoint reads them
// directly, so there is nothing here to download, hold in a tab, or re-upload.

async function callRestore(idToken, body) {
  const res = await fetch("/.netlify/functions/admin-restore", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Restore failed (${res.status})`);
  return data;
}

// Restores one account — by uid or email — or every account to its best known
// state. A full restore is paged by the server, ordered by document id, so it
// is driven here as a loop of small requests: no request has to hold the whole
// user base at once, and a chunk that fails can simply be asked for again.
export async function restoreProgress(idToken, { uid, email, dryRun = false, onProgress } = {}) {
  if (uid || email) return callRestore(idToken, { uid, email, dryRun });

  let cursor = null;
  const total = { dryRun, examined: 0, changed: 0, proRestored: 0, details: [] };
  do {
    const page = await callRestore(idToken, { cursor, dryRun });
    total.examined += page.examined;
    total.changed += page.changed;
    total.proRestored += page.proRestored;
    total.details.push(...(page.details || []));
    cursor = page.nextCursor || null;
    onProgress?.(total.examined);
  } while (cursor);
  return total;
}

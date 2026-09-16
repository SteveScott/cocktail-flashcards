// Client half of the admin erase feature. Every decision that matters is made
// on the server (netlify/functions/admin-erase-user.mjs); this only calls it.
//
// Unlike the restore beside it, there is no "everyone" mode and no paging: the
// endpoint refuses a blank target outright, and one erasure is one request.

async function callErase(idToken, body) {
  const res = await fetch("/.netlify/functions/admin-erase-user", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erase failed (${res.status})`);
  return data;
}

// Look one account up without touching it: the uid and address the server
// resolved, and which of its documents actually exist. The preview an
// irreversible action aimed at somebody else's account ought to have.
export function previewErase(idToken, { uid, email } = {}) {
  return callErase(idToken, { uid, email, dryRun: true });
}

// Erase it. There is no undo: highWater/{uid} and purchaseLedger/{uid} — the two
// copies a restore would otherwise bring everything back from — are part of what
// goes, which is the whole point of the feature and the reason it cannot be
// walked back afterwards.
export function eraseUser(idToken, { uid, email } = {}) {
  return callErase(idToken, { uid, email, dryRun: false });
}

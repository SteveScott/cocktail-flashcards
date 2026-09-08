// Client half of the admin backup/restore feature. Every decision that matters
// is made on the server (netlify/functions/admin-backup.mjs, admin-restore.mjs);
// this only moves the file between the browser and those two endpoints.

import { BACKUP_FORMAT } from "./backup-format.js";

async function callAdmin(path, idToken, body) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} failed (${res.status})`);
  return data;
}

// Pull every page and stitch them into one file. The export is paged because a
// function response is capped at a few megabytes; the file is not.
export async function fetchBackup(idToken, onProgress) {
  let cursor = null;
  let backup = null;
  do {
    const page = await callAdmin("admin-backup", idToken, cursor ? { cursor } : {});
    if (!backup) backup = { ...page, users: [...page.users] };
    else backup.users.push(...page.users);
    cursor = page.nextCursor || null;
    onProgress?.(backup.users.length);
  } while (cursor);

  delete backup.nextCursor;
  backup.counts = { users: backup.users.length, adWhitelist: (backup.adWhitelist || []).length };
  return backup;
}

// A backup is only a backup once it is off the server, so it is handed straight
// to the browser as a file rather than held in a tab someone will close.
export function saveBackupFile(backup) {
  const stamp = (backup.createdAt || new Date().toISOString()).replace(/[:.]/g, "-").slice(0, 19);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `cocktail-flashcards-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a turn of the loop rather than immediately: Safari cancels a
  // download whose blob url is released while the click is still being handled.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readBackupFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (parsed?.format !== BACKUP_FORMAT) throw new Error("That isn't a Cocktail Flashcards backup file.");
  if (!Array.isArray(parsed.users)) throw new Error("That backup has no users in it.");
  return parsed;
}

// The server takes at most 100 users per request, so a full restore goes up in
// chunks. Each user is merged independently and every merge is idempotent, so
// splitting the file this way is exactly equivalent to sending it whole — and a
// chunk that fails can be retried without unpicking the ones that succeeded.
const CHUNK = 100;

export async function restoreBackup(idToken, { backup, uid, email, dryRun = false, onProgress } = {}) {
  const one = Boolean(uid || email);
  const total = { dryRun, examined: 0, changed: 0, proRestored: 0, whitelistRestored: 0, details: [] };

  if (one) {
    const r = await callAdmin("admin-restore", idToken, { backup, uid, email, dryRun });
    return r;
  }

  for (let i = 0; i < backup.users.length; i += CHUNK) {
    const chunk = {
      ...backup,
      users: backup.users.slice(i, i + CHUNK),
      // The whitelist belongs to the file, not to each chunk: sent once, with
      // the first, so it isn't re-walked on every request.
      adWhitelist: i === 0 ? backup.adWhitelist || [] : [],
    };
    const r = await callAdmin("admin-restore", idToken, { backup: chunk, dryRun });
    total.examined += r.examined;
    total.changed += r.changed;
    total.proRestored += r.proRestored;
    total.whitelistRestored += r.whitelistRestored;
    total.details.push(...(r.details || []));
    onProgress?.(total.examined, backup.users.length);
  }
  return total;
}

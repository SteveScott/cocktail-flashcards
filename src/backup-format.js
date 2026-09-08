// The one name both halves agree on. Kept in its own module so the client can
// check a file before uploading it without importing anything server-side —
// netlify/functions/_backup.mjs pulls in firebase-admin, which must never reach
// the browser bundle.
export const BACKUP_FORMAT = "cocktail-flashcards/backup";
export const BACKUP_VERSION = 1;

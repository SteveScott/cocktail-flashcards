// Build-time stamping for the service worker.
//
// WHY THIS EXISTS
// ---------------
// public/pwa-sw.js is copied into dist verbatim, so before this plugin its bytes
// were the same on every deploy — and a service worker only reinstalls when its
// bytes change. That is what made the offline app a fossil: `install` is the only
// thing that precaches the shell, so a client's cached index.html was frozen at
// whichever build last happened to edit the worker, and the hashed CSS and JS it
// names were frozen with it. Opening the app with no signal showed the colour
// scheme of that build, months of releases later.
//
// So the worker is stamped here with a hash of what this build actually
// produced. New bundle, new stamp, new worker bytes — which reinstalls it, which
// re-precaches the current shell and drops every older cache. The stamp is a
// content hash rather than a timestamp so it means something on its own; in
// practice it moves on every build anyway, because __BUILD_TIME__ (vite.config.js)
// is compiled into the bundle and so into its filename. That costs no extra
// bytes: index.html is served must-revalidate and already names new hashed
// assets after every deploy, so the precache only fetches them sooner.
//
// Runs in closeBundle, after Vite has copied public/ into dist — same as
// seo-pages.mjs, and for the same reason: the file being rewritten is the copy.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

// Everything the app needs to boot with no network, beyond what index.html
// itself names. Deliberately NOT the fonts or the bar photograph: they are
// another 400 KB, they are fetched by the same online page view that installs
// the worker, and neither blocks a usable screen — the faces are `font-display:
// swap` and the photograph sits under a background colour that is already right.
const SHELL = ["/", "/index.html", "/manifest.json", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

// The entry script, its modulepreloads and the stylesheet, as index.html names
// them. Only root-relative URLs: anything absolute is another origin's problem.
const assetsIn = (html) =>
  [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith("/assets/"));

export function pwaServiceWorker() {
  let out = "dist";
  return {
    name: "pwa-service-worker",
    apply: "build",
    configResolved(config) {
      out = config.build.outDir;
    },
    async closeBundle() {
      const swPath = join(out, "pwa-sw.js");
      const html = await readFile(join(out, "index.html"), "utf8");
      const sw = await readFile(swPath, "utf8");

      const precache = [...new Set([...SHELL, ...assetsIn(html)])];

      // Hashed over the shell's contents and the worker's own source, so the
      // stamp moves when — and only when — something a client caches has moved.
      // Not a timestamp: Netlify builds on every push, and a timestamp would
      // throw away every client's cache for a README edit.
      const build = createHash("sha256")
        .update(html).update(sw).update(precache.join("\n"))
        .digest("base64url").slice(0, 12);

      // Both lines carry an @stamp marker rather than being matched on their
      // value, and a miss is fatal: silently shipping the dev fallback would
      // restore the exact bug this plugin exists to fix, and would look fine.
      const stamped = [
        [/^const BUILD = .*\/\/ @stamp:build$/m, `const BUILD = ${JSON.stringify(build)}; // @stamp:build`],
        [/^const PRECACHE = .*\/\/ @stamp:precache$/m, `const PRECACHE = ${JSON.stringify(precache)}; // @stamp:precache`],
      ].reduce((src, [re, line]) => {
        if (!re.test(src)) throw new Error(`pwa-service-worker: no ${re} in ${swPath}`);
        return src.replace(re, line);
      }, sw);

      await writeFile(swPath, stamped, "utf8");

      const msg = `pwa-sw: build ${build}, ${precache.length} files precached`;
      if (this.info) this.info(msg); else console.log(msg);
    },
  };
}

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { seoPages } from './scripts/seo-pages.mjs'

// The recipe data is read here (not imported as JSON, which would need an
// assert clause in this context) and handed to the generator, so the static
// pages and the app bundle are built from the identical source.
const cocktails = createRequire(import.meta.url)('./src/cocktails.json')
const ALL = [...cocktails.top50, ...cocktails.master150]

// Stamped into the bundle so a device can say WHICH build it is running. The
// Capacitor shell loads the deployed site and a WebView caches it, so "the fix
// isn't working" and "the fix isn't deployed" look identical without this.
const BUILD_TIME = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    // Emits dist/cocktails/<slug>.html for every recipe (Netlify serves these
    // at /cocktails/<slug>), the browse-all index, and a sitemap covering them.
    // See scripts/seo-pages.mjs and docs/seo.md for why this exists.
    seoPages(ALL),
  ],
  build: {
    // The seo-recipe-pages plugin clears outDir itself, in buildStart, with a
    // retry. Vite's built-in clean is a single rmSync: on Windows, Dropbox and
    // Defender hold handles on newly written files for a second or two, and
    // with 300+ generated pages in dist that made every repeat build fail with
    // EPERM. Leave this false unless that plugin is removed too.
    emptyOutDir: false,
    rolldownOptions: {
      output: {
        // Split the two big dependencies out of the app chunk. This does not
        // make the app any smaller — the same bytes are still downloaded on a
        // cold visit — but it stops a one-line change to App.jsx from
        // invalidating the Firebase SDK in everyone's cache, which is most of
        // what is being shipped. It also puts every chunk back under Vite's
        // 500 kB warning, so the build has no warnings left to get used to
        // ignoring.
        //
        // Deliberately NOT a step towards lazy-loading Firebase: `auth`, `db`
        // and `firebaseEnabled` are read at module scope in firebase.js and
        // App.jsx, so making them async would mean threading a loading state
        // through every auth-gated path. These chunks are still fetched
        // eagerly; they are only cached apart.
        // Firestore and Auth are separate SDKs that happen to ship under one
        // package name, and Firestore alone is over the limit, so they are
        // grouped apart rather than as one "firebase". The small shared pieces
        // (app, component, installations) are left unmatched on purpose: given
        // a group of their own they came out as a 110-byte chunk, which is a
        // whole extra request to save nothing.
        codeSplitting: {
          groups: [
            { name: 'firebase-firestore', test: /node_modules[\\/]@firebase[\\/]firestore[\\/]/ },
            { name: 'firebase-auth', test: /node_modules[\\/]@firebase[\\/]auth[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})

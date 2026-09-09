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
  },
})

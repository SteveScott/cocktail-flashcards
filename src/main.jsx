import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the PWA service worker (needed for installability, and it also runs
// inside the Capacitor shell's WebView, which loads this same site). Registered
// after load so it never blocks first paint.
//
// It lives at /pwa-sw.js, not the conventional /sw.js. PropellerAds claimed that
// path for a site-ownership file while it was the ad network; the network is gone
// and the file with it, but the worker stays at /pwa-sw.js rather than moving
// back — every visitor since has a registration pointing here, and a second move
// would churn their offline shell for no gain.
//
// The unregister step is what keeps that decision safe. Visitors from before the
// move still have a registration whose script URL is /sw.js, and browsers
// re-fetch that URL to check for updates. Nothing is served there now, so leaving
// them alone would strand a worker this app no longer controls — including inside
// the Play app, which loads this same site. Dropping the old registration first
// is what prevents that. It should stay until it's safe to assume none survive.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      for (const reg of await navigator.serviceWorker.getRegistrations()) {
        const url = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || ''
        // Endswith '/sw.js' matches only the old worker — '/pwa-sw.js' ends
        // with '-sw.js' and is deliberately left alone.
        if (url.endsWith('/sw.js')) await reg.unregister()
      }
    } catch (e) {
      console.error('Old service worker cleanup failed', e)
    }
    navigator.serviceWorker.register('/pwa-sw.js').catch((e) => console.error('SW registration failed', e))
  })
}

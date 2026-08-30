import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ConsentBanner from './ConsentBanner.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <ConsentBanner />
  </StrictMode>,
)

// Register the PWA service worker (needed for installability, and it also runs
// inside the Capacitor shell's WebView, which loads this same site). Registered
// after load so it never blocks first paint.
//
// It lives at /pwa-sw.js, not the conventional /sw.js, because PropellerAds
// claimed that path: /sw.js is now their site-ownership verification file, which
// their dashboard requires to stay put. Serving that file is harmless — a
// service worker only does anything once something registers it, and nothing
// here does.
//
// The unregister step is NOT optional. Every existing visitor already has a
// registration whose script URL is /sw.js, and browsers re-fetch that URL to
// check for updates. Leave it in place and the next update would hand them
// PropellerAds' push worker — including inside the Play app, which loads this
// same site. Dropping the old registration first is what prevents that.
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

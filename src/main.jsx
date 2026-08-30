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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW registration failed', e))
  })
}

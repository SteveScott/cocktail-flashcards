import { useState, useEffect } from "react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import {
  auth, db, googleProvider, facebookProvider, firebaseEnabled,
  isEmailAdWhitelisted, addEmailToAdWhitelist, removeEmailFromAdWhitelist, listAdWhitelist,
} from "./firebase";
import cocktailData from './cocktails.json';
import { FEATURES } from './platform';
import { openPrivacySettings, onGdprApplicable } from './consent';
import {
  initMonetization, showBanner, hideBanner, purchaseRemoveAds, restorePurchases,
  linkRevenueCatUser, unlinkRevenueCatUser, onEntitlementChange,
  presentPaywall, presentCustomerCenter, isBillingAvailable, isUserCancelled,
  PAYWALL_OUTCOME, getAdConsentState, showAdPrivacyOptions,
} from './monetization';

const { top50, master150 } = cocktailData;
const ALL_200 = [...top50, ...master150];

const DECK_SIZE = 20;
const MASTERY_SCORE = 6;
const STORAGE_KEY = "cocktail_state_v4";
// Facebook Login is fully implemented (src/firebase.js + signInFacebook) but temporarily
// hidden from the UI until the Facebook app is configured. Flip to true to re-enable.
const FACEBOOK_LOGIN_ENABLED = false;

// Emails allowed to manage the ad whitelist from the in-app admin panel. Set via
// VITE_ADMIN_EMAILS (comma-separated) in .env. This is a UI-only gate — the real
// access control must come from Firestore security rules (see README).
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const ADSENSE_SCRIPT_ID = "adsbygoogle-script";
function loadAdsenseScript() {
  if (document.getElementById(ADSENSE_SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = ADSENSE_SCRIPT_ID;
  script.async = true;
  script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3044363631644079";
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
}

const GLASS_ICONS = [
  ["champagne", "🥂"],
  ["martini", "🍸"],
  ["nick & nora", "🍸"],
  ["coupe", "🍸"],
  ["wine", "🍷"],
  ["tiki", "🍹"],
  ["hurricane", "🍹"],
  ["poco grande", "🍹"],
  ["copper mug", "🍺"],
  ["pint", "🍺"],
  ["irish coffee", "☕"],
  ["heatproof", "☕"],
  ["shot", "🥃"],
  ["rocks", "🥃"],
  ["julep", "🥤"],
  ["highball", "🥛"],
  ["collins", "🥤"],
  ["sling", "🥤"],
  ["zombie", "🥤"],
];

const BUILT_GLASSES = /highball|collins|copper mug|pint|wine|sling|zombie/;
const BUILT_MIXERS = /soda water|tonic|ginger beer|coca-cola|\bcola\b|tomato juice|clamato|beer|champagne|prosecco|tequila blanco|grapefruit soda|lemonade/;

// Fold text to lowercase ASCII so accented characters match their plain form
// (e.g. "piña" and "pina", "crème" and "creme") in search.
function norm(s) {
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function getMethod(c) {
  const name = c.name.toLowerCase();
  const ing = c.ingredients.toLowerCase();
  const glass = (c.glass || "").toLowerCase();

  if (/blend|frozen/.test(name) || /blend/.test(ing)) return "Blended";
  if (/layered/.test(ing)) return "Layered";
  if (BUILT_GLASSES.test(glass) && BUILT_MIXERS.test(ing)) return "Built";
  if (/egg white|egg\b|heavy cream|cream of coconut|coconut cream|purée|puree|half-and-half/.test(ing)) return "Shaken";
  if (/fresh (lime|lemon|grapefruit|orange) juice|simple syrup|honey syrup|grenadine|orgeat|agave nectar|\bsyrup\b/.test(ing)) return "Shaken";
  return "Stirred";
}

function initState(masterMode) {
  const pool = masterMode ? ALL_200 : top50;
  const scores = {};
  pool.forEach(c => { scores[c.name] = 0; });
  return { scores, active: pool.slice(0, Math.min(DECK_SIZE, pool.length)).map(c => c.name), masterMode, learned: [], deckSize: DECK_SIZE };
}

function refillDeck(st, pool) {
  const target = st.deckSize || DECK_SIZE;
  const lSet = new Set(st.learned), aSet = new Set(st.active);
  const avail = pool.map(c => c.name).filter(n => !lSet.has(n) && !aSet.has(n));
  const na = [...st.active];
  while (na.length < target && avail.length > 0) na.push(avail.shift());
  return { ...st, active: na };
}

function loadLocal() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (!r) return null;
    const s = JSON.parse(r);
    if (s?.active?.length && typeof s.active[0] === "number") return null;
    return s;
  } catch { return null; }
}
function saveLocal(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// Merge two progress states (e.g. local device + cloud account) without losing progress either side made.
function mergeStates(a, b) {
  if (!a) return b;
  if (!b) return a;
  const scores = { ...a.scores };
  for (const k in b.scores) scores[k] = Math.max(scores[k] || 0, b.scores[k] || 0);
  const learned = Array.from(new Set([...(a.learned||[]), ...(b.learned||[])]));
  const masterMode = a.masterMode || b.masterMode;
  const pool = masterMode ? ALL_200 : top50;
  const lSet = new Set(learned);
  const active = Array.from(new Set([...(a.active||[]), ...(b.active||[])])).filter(n => !lSet.has(n));
  const deckSize = a.deckSize || b.deckSize || DECK_SIZE;
  return refillDeck({ scores, learned, active, masterMode, deckSize }, pool);
}

// True when two progress states carry the same progress (identity aside).
// Live cloud sync needs this: folding a remote update into local state produces
// a NEW object every time, which would re-trigger the autosave effect, which
// would echo back as another snapshot — an endless write loop. Because
// mergeStates is idempotent, comparing by value lets us keep `prev` when the
// merge changed nothing and break the cycle.
function progressEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Boolean(a.masterMode) !== Boolean(b.masterMode)) return false;
  if ((a.deckSize || DECK_SIZE) !== (b.deckSize || DECK_SIZE)) return false;
  const sameList = (x = [], y = []) => x.length === y.length && x.every((n, i) => n === y[i]);
  if (!sameList(a.learned, b.learned) || !sameList(a.active, b.active)) return false;
  const keys = new Set([...Object.keys(a.scores || {}), ...Object.keys(b.scores || {})]);
  for (const k of keys) if ((a.scores?.[k] || 0) !== (b.scores?.[k] || 0)) return false;
  return true;
}

export default function App() {
  const [st, setSt] = useState(() => loadLocal() || initState(false));
  const [mode, setMode] = useState("menu");
  const [di, setDi] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [qa, setQa] = useState([]);
  const [qi, setQi] = useState(0);
  const [qr, setQr] = useState(false);
  const [quizPool, setQuizPool] = useState([]);
  const [saved, setSaved] = useState("");
  const [search, setSearch] = useState("");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!firebaseEnabled);
  const [adWhitelisted, setAdWhitelisted] = useState(false);
  const [adCheckDone, setAdCheckDone] = useState(!firebaseEnabled);
  const [showAdAdmin, setShowAdAdmin] = useState(false);
  const [whitelist, setWhitelist] = useState([]);
  const [whitelistInput, setWhitelistInput] = useState("");
  const [whitelistMsg, setWhitelistMsg] = useState("");
  // Ad removal has two independent sources and they must never overwrite each
  // other: `adsRemovedCloud` is the account-wide flag in Firestore (written
  // server-side by the Stripe and RevenueCat webhooks — the cross-platform
  // source of truth), while `adsRemovedNative` is what the Play Billing SDK
  // reports on THIS device. Keeping them apart means a slow Firestore read can't
  // revoke a native purchase, and a "no purchase found" restore can't revoke a
  // web one. Ad-free is the union.
  const [adsRemovedCloud, setAdsRemovedCloud] = useState(false);
  const [adsRemovedNative, setAdsRemovedNative] = useState(false);
  // The uid RevenueCat's app-user id is confirmed to be set to. Stored as the
  // uid rather than a boolean so switching accounts invalidates it on its own,
  // and so it can't be stale-true for the previous user.
  const [linkedUid, setLinkedUid] = useState(null);
  // Web only: whether GDPR applies to this visitor, per Google's TCF data. Gates
  // the "Privacy & cookie settings" link, which is meaningless outside scope.
  const [gdprApplies, setGdprApplies] = useState(false);
  // Android only: whether Google's UMP wants us to offer a way back into the
  // consent choice (it does in the EEA/UK once a choice has been made).
  const [privacyOptionsRequired, setPrivacyOptionsRequired] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseMsg, setPurchaseMsg] = useState("");
  // Email/password sign-in exists mainly so Play Console's App access reviewers
  // have credentials that work — OAuth accounts trip Google's own security
  // challenges from a reviewer's device. Kept collapsed behind a text link so
  // Google stays the obvious choice for everyone else.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const adFree = adWhitelisted || adsRemovedCloud || adsRemovedNative;

  const isAdmin = firebaseEnabled && Boolean(user?.email) && ADMIN_EMAILS.includes(user.email.toLowerCase());

  const pool = st.masterMode ? ALL_200 : top50;
  const learned = st.learned?.length || 0;
  const total = pool.length;
  const deckSize = st.deckSize || DECK_SIZE;

  useEffect(() => {
    saveLocal(st);
    setSaved("✓"); setTimeout(() => setSaved(""), 1200);
  }, [st]);

  // Complete a redirect-based sign-in if one is in progress (fallback for when the popup gets closed early).
  useEffect(() => {
    if (!firebaseEnabled) return;
    getRedirectResult(auth).catch(e => console.error("Redirect sign-in failed", e));
  }, []);

  // Watch Google sign-in state and keep a LIVE subscription to the signed-in
  // user's cloud doc. Subscribing (rather than reading once at sign-in) is what
  // makes web and mobile converge: progress mastered in the Play app and an
  // ad-removal purchase made on either platform both land on this same doc, and
  // every other signed-in device picks them up while it's open.
  useEffect(() => {
    if (!firebaseEnabled) return;
    let unsubDoc = null;
    const stopDoc = () => { if (unsubDoc) { unsubDoc(); unsubDoc = null; } };
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      stopDoc();
      if (u) {
        // The first snapshot is the sign-in handshake (reconcile whatever is on
        // this device with the account); later ones are updates from elsewhere.
        let firstSnapshot = true;
        unsubDoc = onSnapshot(doc(db, "users", u.uid), (snap) => {
          // Our own un-acked writes echo back locally first — ignore them so a
          // half-applied local state never round-trips as if it were remote.
          if (snap.metadata.hasPendingWrites) return;
          const data = snap.exists() ? snap.data() : null;
          const cloud = data?.progress || null;
          setAdsRemovedCloud(Boolean(data?.adsRemoved));

          if (firstSnapshot) {
            firstSnapshot = false;
            // Persist the resolved progress from inside the updater: the value
            // isn't available synchronously outside it (React runs the updater during
            // render, not at call time), which previously wrote `progress: undefined`.
            setSt(prev => {
              // Fold local progress into the account only when it's worth keeping and
              // safe to keep: either it already belongs to THIS user (preserve offline
              // changes), or it's anonymous local progress the person actually built up
              // before signing in. Otherwise — a different account was loaded, or it's
              // just the default starter deck — load this user's own cloud progress so
              // one account never bleeds into another.
              const sameUser = prev.uid && prev.uid === u.uid;
              const hasLocalProgress =
                (prev.learned && prev.learned.length > 0) ||
                Object.values(prev.scores || {}).some(v => v > 0);
              const anonymousWithProgress = !prev.uid && hasLocalProgress;
              const resolved = (sameUser || anonymousWithProgress)
                ? mergeStates(prev, cloud)
                : (cloud ? refillDeck(cloud, cloud.masterMode ? ALL_200 : top50) : initState(false));
              const stamped = { ...resolved, uid: u.uid };
              setDoc(doc(db, "users", u.uid), { progress: stamped, updatedAt: Date.now() }, { merge: true })
                .catch(e => console.error("Cloud sync failed", e));
              return stamped;
            });
            setDi(0); setRevealed(false);
            return;
          }

          // A later update — another device (or the other platform) changed this
          // account. Merge rather than replace so progress made here in the
          // meantime survives, and bail out when the merge is a no-op so we don't
          // bounce a fresh object back into the autosave effect forever.
          if (!cloud) return;
          setSt(prev => {
            if (prev.uid !== u.uid) return prev;
            const merged = { ...mergeStates(prev, cloud), uid: u.uid };
            if (progressEqual(prev, merged)) return prev;
            // The remote update can drop the card we're sitting on, so keep the
            // study index inside the new deck.
            setDi(d => Math.min(d, Math.max(0, merged.active.length - 1)));
            return merged;
          });
        }, e => console.error("Cloud sync failed", e));
      } else {
        setAdsRemovedCloud(false);
        // Clear progress on sign-out so the next user starts fresh — but only if
        // it belonged to a signed-in account. Don't wipe a purely anonymous
        // device's local progress on the initial "no user" callback at startup.
        setSt(prev => (prev.uid ? initState(false) : prev));
        setDi(0); setRevealed(false);
      }
      setAuthReady(true);
    });
    return () => { stopDoc(); unsub(); };
  }, []);

  // Keep the RevenueCat identity pinned to the Firebase uid so a Play purchase
  // is recorded against the account the web signs in with (see monetization.js).
  // No-op outside the Play build.
  useEffect(() => {
    if (!FEATURES.nativePurchase || !authReady) return;
    const sync = user ? linkRevenueCatUser(user.uid) : unlinkRevenueCatUser();
    sync.then(({ ok, active }) => {
      setLinkedUid(ok && user ? user.uid : null);
      setAdsRemovedNative(Boolean(active));
    });
  }, [authReady, user]);

  // After returning from Stripe Checkout, re-check the ads-removed flag a few
  // times since the webhook that sets it runs asynchronously and may lag
  // slightly behind the redirect back to the app.
  useEffect(() => {
    if (!firebaseEnabled) return;
    const params = new URLSearchParams(window.location.search);
    const purchase = params.get("purchase");
    if (!purchase) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (purchase === "success") {
      setPurchaseMsg("Thanks for your purchase! Finishing up…");
      let attempts = 0;
      const check = async () => {
        attempts += 1;
        const u = auth.currentUser;
        if (u) {
          try {
            const snap = await getDoc(doc(db, "users", u.uid));
            if (snap.exists() && snap.data().adsRemoved) {
              setAdsRemovedCloud(true);
              setPurchaseMsg("Ads removed. Thanks for your support!");
              return;
            }
          } catch (e) { console.error("Failed to confirm purchase", e); }
        }
        if (attempts < 6) setTimeout(check, 1500);
        else setPurchaseMsg("Purchase received — it may take a minute to apply.");
      };
      check();
    } else if (purchase === "cancelled") {
      setPurchaseMsg("Checkout cancelled.");
    }
  }, []);

  // Push progress to the cloud whenever it changes and a user is signed in.
  useEffect(() => {
    if (!firebaseEnabled || !user) return;
    const t = setTimeout(() => {
      // merge:true so autosaving progress never clobbers server-owned fields
      // like `adsRemoved` (set by the Stripe webhook via the Admin SDK).
      setDoc(doc(db, "users", user.uid), { progress: st, updatedAt: Date.now() }, { merge: true }).catch(e => console.error("Cloud save failed", e));
    }, 800);
    return () => clearTimeout(t);
  }, [st, user]);

  // Check whether the signed-in user's email is on the ad whitelist.
  useEffect(() => {
    if (!firebaseEnabled || !authReady) return;
    if (!user?.email) { setAdWhitelisted(false); setAdCheckDone(true); return; }
    let cancelled = false;
    setAdCheckDone(false);
    isEmailAdWhitelisted(user.email)
      .then(w => { if (!cancelled) { setAdWhitelisted(w); setAdCheckDone(true); } })
      .catch(e => { console.error("Ad whitelist check failed", e); if (!cancelled) { setAdWhitelisted(false); setAdCheckDone(true); } });
    return () => { cancelled = true; };
  }, [authReady, user]);

  // Only load the AdSense script once we know the current user isn't ad-free.
  // Never load it in the Play Store build — AdSense-in-app breaks program policy.
  //
  // Deliberately NOT gated on consent: Google's GDPR message is delivered by
  // this very tag, so blocking it would block the consent prompt itself. Ads are
  // withheld until consent by Google's CMP, and Consent Mode defaults (index.html)
  // keep storage denied across the EEA/UK/CH until the user decides.
  useEffect(() => {
    if (!FEATURES.ads || !adCheckDone || adFree) return;
    loadAdsenseScript();
  }, [adCheckDone, adFree]);

  // Show the privacy-settings link only where GDPR applies (web build).
  useEffect(() => {
    if (!FEATURES.ads) return;
    onGdprApplicable(applies => setGdprApplies(applies));
  }, []);

  // Play (Capacitor) build: initialize AdMob + Play Billing once, and adopt any
  // ad-removal purchase this device already owns. Firestore stays the account-wide
  // source of truth; this is the local read that keeps the app ad-free offline and
  // before sign-in.
  useEffect(() => {
    if (!FEATURES.nativeAds && !FEATURES.nativePurchase) return;
    initMonetization().then(({ adsRemoved: owned }) => {
      if (owned) setAdsRemovedNative(true);
      // Consent was gathered during init; surface the privacy-options entry
      // point if UMP says this user is entitled to one.
      setPrivacyOptionsRequired(getAdConsentState().privacyOptionsRequired);
    });
    // Entitlement can change without any call of ours returning — a purchase
    // completed inside the paywall sheet, a restore from the Customer Center, a
    // transfer between accounts. RevenueCat's CustomerInfo listener reports all
    // of them, so the UI never shows ads to someone who just paid.
    return onEntitlementChange(active => setAdsRemovedNative(active));
  }, []);

  // Play build: show the AdMob banner while the user isn't ad-free, hide it once
  // they are. No-ops on web.
  useEffect(() => {
    if (!FEATURES.nativeAds || !adCheckDone) return;
    if (adFree) hideBanner(); else showBanner();
  }, [adCheckDone, adFree]);

  // Load the whitelist list when an admin opens the admin panel.
  useEffect(() => {
    if (!isAdmin || !showAdAdmin) return;
    listAdWhitelist().then(setWhitelist).catch(e => console.error("Failed to load ad whitelist", e));
  }, [isAdmin, showAdAdmin]);

  function signIn(provider = googleProvider) {
    if (!firebaseEnabled) { alert("Cloud sync isn't configured for this app yet."); return; }
    signInWithPopup(auth, provider).catch(e => {
      console.error("Popup sign-in failed, falling back to redirect", e);
      // Popups can be closed prematurely by browser privacy settings or extensions — fall back to a full-page redirect.
      signInWithRedirect(auth, provider).catch(e2 => console.error("Redirect sign-in failed", e2));
    });
  }
  function signInFacebook() { signIn(facebookProvider); }

  // No popup or redirect here, so none of the OAuth failure modes apply — which
  // is the whole point of offering it to reviewers.
  async function signInEmail(e) {
    e.preventDefault();
    if (!firebaseEnabled || emailBusy) return;
    setEmailBusy(true);
    setEmailErr("");
    try {
      await signInWithEmailAndPassword(auth, emailInput.trim(), passwordInput);
      // onAuthStateChanged drives the rest; just clear the form.
      setPasswordInput("");
      setShowEmailForm(false);
    } catch (err) {
      console.error("Email sign-in failed:", err.code, err.message, err);
      // Firebase returns invalid-credential for wrong password AND unknown
      // account, so don't claim to know which — saying "no such account" would
      // also confirm to a stranger which addresses are registered.
      setEmailErr(
        err.code === "auth/invalid-email" ? "That doesn't look like an email address."
        : err.code === "auth/too-many-requests" ? "Too many attempts. Try again shortly."
        : err.code === "auth/network-request-failed" ? "Network error. Check your connection."
        : "Email or password is incorrect."
      );
    } finally {
      setEmailBusy(false);
    }
  }
  function signOutUser() {
    if (!firebaseEnabled) return;
    signOut(auth).catch(e => console.error("Sign-out failed", e));
  }

  async function startCheckout() {
    if (!user) { alert("Sign in first to remove ads."); return; }
    setPurchasing(true);
    setPurchaseMsg("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/.netlify/functions/create-checkout-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Failed to start checkout");
      window.location.href = data.url;
    } catch (e) {
      console.error("Failed to start checkout", e);
      // Surface the server's specific reason (e.g. "Payments aren't configured yet")
      // so the failure is diagnosable instead of always showing a generic message.
      setPurchaseMsg(e?.message ? `Couldn't start checkout — ${e.message}` : "Couldn't start checkout — please try again.");
      setPurchasing(false);
    }
  }

  // Play (Capacitor) build: buy ad removal through Google Play Billing.
  async function buyRemoveAdsNative() {
    // Require sign-in like the web checkout does: the purchase is recorded
    // against the RevenueCat app-user id, and only when that id is the Firebase
    // uid can the webhook mark the account ad-free for the web too.
    if (firebaseEnabled && !user) {
      setPurchaseMsg("Sign in first so your purchase works on the web too.");
      return;
    }
    if (!isBillingAvailable()) {
      setPurchaseMsg("Purchases aren't available in this build.");
      return;
    }
    setPurchasing(true);
    setPurchaseMsg("");
    try {
      // Confirm the RevenueCat identity is this uid before taking any money.
      // Having a Firebase user only means auth resolved — Purchases.logIn may
      // still be in flight, or may have failed, and a purchase started first is
      // recorded against the previous or anonymous app-user id, which the
      // webhook can never map back to this account. logIn is idempotent, so
      // re-confirming here is cheap and doubles as a retry.
      if (firebaseEnabled && user) {
        const { ok } = await linkRevenueCatUser(user.uid);
        if (!ok) {
          setPurchaseMsg("Couldn't link your account to the store — check your connection and try again.");
          return;
        }
        setLinkedUid(user.uid);
      }
      // The dashboard-hosted paywall is the primary path: pricing and copy are
      // edited in RevenueCat, not shipped in an app release. Fall back to a
      // direct purchase of the offering's first package only when there was no
      // paywall to show, so the button is never a dead end — never after a
      // cancellation, which would push a purchase dialog at someone who just
      // backed out.
      const outcome = await presentPaywall();
      let ok = outcome === PAYWALL_OUTCOME.PURCHASED;
      if (outcome === PAYWALL_OUTCOME.UNAVAILABLE) ok = await purchaseRemoveAds();
      if (ok) { setAdsRemovedNative(true); setPurchaseMsg("You're Pro — ads are gone. Thanks for your support!"); }
      else if (outcome !== PAYWALL_OUTCOME.CANCELLED) setPurchaseMsg("Purchase didn't complete.");
    } catch (e) {
      console.error("Play purchase failed", e);
      // RevenueCat rejects on user cancellation too — don't alarm the user then.
      if (!isUserCancelled(e)) setPurchaseMsg("Couldn't complete the purchase — please try again.");
    } finally {
      setPurchasing(false);
    }
  }

  // Play build: restore a previous purchase (required by Play policy).
  async function restoreAdsNative() {
    setPurchaseMsg("");
    try {
      const ok = await restorePurchases();
      // Only ever grants here — a Play account with no purchase must not clear an
      // ad-free status this account earned on the web.
      if (ok) setAdsRemovedNative(true);
      setPurchaseMsg(ok ? "Purchase restored." : "No previous purchase found.");
    } catch (e) {
      console.error("Restore failed", e);
      setPurchaseMsg("Couldn't restore — please try again.");
    }
  }

  // Play build: reopen Google's UMP privacy form so ad consent can be changed
  // or withdrawn. Re-checks whether ads may now be shown afterwards.
  async function openAdPrivacyOptions() {
    await showAdPrivacyOptions();
    const { canRequestAds, privacyOptionsRequired: required } = getAdConsentState();
    setPrivacyOptionsRequired(required);
    // Consent may have been withdrawn — drop any banner already on screen.
    if (!canRequestAds) hideBanner();
  }

  // Play build: RevenueCat's Customer Center — restore, refund requests,
  // subscription management and support in one sheet, so those never become
  // support email. Entitlement can change inside it, hence the state update.
  async function openCustomerCenter() {
    setPurchaseMsg("");
    try {
      const active = await presentCustomerCenter();
      if (active) setAdsRemovedNative(true);
    } catch (e) {
      console.error("Customer Center failed", e);
      setPurchaseMsg("Couldn't open purchase management — please try again.");
    }
  }

  async function addToWhitelist() {
    const email = whitelistInput.trim().toLowerCase();
    if (!email) return;
    try {
      await addEmailToAdWhitelist(email, user?.email);
      setWhitelistInput("");
      setWhitelistMsg(`Added ${email}`);
      setWhitelist(await listAdWhitelist());
    } catch (e) {
      console.error("Failed to add to ad whitelist", e);
      setWhitelistMsg("Failed to add — check console.");
    }
  }
  async function removeFromWhitelist(email) {
    try {
      await removeEmailFromAdWhitelist(email);
      setWhitelist(w => w.filter(x => x.email !== email));
    } catch (e) { console.error("Failed to remove from ad whitelist", e); }
  }

  const col = s => s >= MASTERY_SCORE ? "#22c55e" : s >= 4 ? "#f59e0b" : s >= 2 ? "#3b82f6" : "#6b7280";

  function upd(fn) { setSt(p => typeof fn === "function" ? fn(p) : fn); }

  function glassIcon(glass) {
    if (!glass) return "🥃";
    const g = glass.toLowerCase();
    let best = null, bestIdx = Infinity;
    for (const [kw, icon] of GLASS_ICONS) {
      const idx = g.indexOf(kw);
      if (idx !== -1 && idx < bestIdx) { bestIdx = idx; best = icon; }
    }
    return best || "🥃";
  }

  function grade(correct) {
    // Clamped for the same reason as the study render: a live sync from another
    // device can drop the card this index pointed at.
    const cur = Math.min(di, st.active.length - 1);
    if (cur < 0) return;
    upd(p => {
      const ci = p.active[cur];
      const ns = Math.max(0, (p.scores[ci] || 0) + (correct ? 1 : -1));
      const scores = { ...p.scores, [ci]: ns };
      let active = [...p.active], learned = [...(p.learned||[])];
      const mastered = ns >= MASTERY_SCORE;
      if (mastered) { learned.push(ci); active.splice(cur, 1); }
      const u = refillDeck({ ...p, scores, active, learned }, pool);
      const next = mastered ? Math.min(cur, u.active.length-1) : u.active.length > 0 ? (cur+1) % u.active.length : 0;
      setDi(Math.max(0, next)); setRevealed(false);
      return u;
    });
  }

  function next() { setDi(i => (i+1) % st.active.length); setRevealed(false); }
  function prev() { setDi(i => (i-1+st.active.length) % st.active.length); setRevealed(false); }
  // Build a fresh, fully-shuffled quiz order every time — quizzing always draws
  // the whole pool in random sequence (Fisher–Yates), never the fixed pool order.
  function startQuiz() {
    const q = [...pool];
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    setQuizPool(q); setQa([]); setQi(0); setQr(false); setMode("quiz");
  }
  function qGrade(k) {
    const ans = [...qa, k];
    setQa(ans);
    if (qi+1 >= quizPool.length) setMode("results");
    else { setQi(i=>i+1); setQr(false); }
  }
  function toggleMaster() {
    upd(p => {
      const m = !p.masterMode, np = m ? ALL_200 : top50;
      const validNames = new Set(np.map(c => c.name));
      const scores = {...p.scores};
      np.forEach(c => { if (scores[c.name] === undefined) scores[c.name] = 0; });
      const lrn = (p.learned||[]).filter(n => validNames.has(n));
      const act = p.active.filter(n => validNames.has(n));
      return refillDeck({...p, scores, learned:lrn, active:act, masterMode:m}, np);
    });
  }
  function reset() {
    if (!confirm("Reset all progress?")) return;
    setSt(initState(st.masterMode)); setDi(0); setRevealed(false);
  }
  // Add or remove a cocktail from the study deck (st.active) by name. Adding a
  // cocktail also gives it a starting score and pulls it out of `learned` so it
  // reappears in study; removing just drops it from the deck.
  function toggleStudy(name) {
    upd(p => {
      if (p.active.includes(name)) return { ...p, active: p.active.filter(n => n !== name) };
      const scores = { ...p.scores };
      if (scores[name] === undefined) scores[name] = 0;
      const learned = (p.learned || []).filter(n => n !== name);
      return { ...p, scores, learned, active: [...p.active, name] };
    });
  }
  // Randomize the order of the study deck (Fisher–Yates) and jump to the first card.
  function shuffleActive() {
    upd(p => {
      const a = [...p.active];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return { ...p, active: a };
    });
    setDi(0); setRevealed(false);
  }
  // Change how many cards the study deck holds. Shrinking trims the extra cards
  // immediately (from the end; their scores are kept); growing refills from the pool.
  function setDeckSizeTo(n) {
    upd(p => {
      const np = p.masterMode ? ALL_200 : top50;
      const active = p.active.length > n ? p.active.slice(0, n) : p.active;
      return refillDeck({ ...p, deckSize: n, active }, np);
    });
    setDi(0); setRevealed(false);
  }

  const wrap = { maxWidth:480, width:"100%" };
  const page = { minHeight:"100dvh", background:"rgba(15, 23, 42, 0.2)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", color:"#f1f5f9", display:"flex", flexDirection:"column", alignItems:"center", padding:"1.5rem 1rem" };
  const btn = (bg, x={}) => ({ padding:"1rem", borderRadius:12, background:bg, color:"#fff", fontWeight:700, fontSize:"1rem", border:"none", cursor:"pointer", ...x });
  const FRAME_BG = "rgba(15, 23, 42, 0.55)";
  const frame = (x={}) => ({ background:FRAME_BG, backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", ...x });
  // flex-basis 8rem with minWidth 0 lets the two fields sit side by side on a
  // wide frame and stack on a phone without overflowing it.
  const emailField = { flex:"1 1 8rem", minWidth:0, background:"#0f172a", border:"1px solid #33415560", borderRadius:8, padding:"0.4rem 0.6rem", fontSize:"0.8rem", color:"#e2e8f0" };

  if (mode === "menu") return (
    <div style={page}><div style={wrap}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.15rem"}}>
        <h1 style={{fontSize:"1.8rem",fontWeight:800,margin:0,color:"#f8fafc"}}>🍹 Cocktail Flashcards</h1>
        <span style={{fontSize:"0.7rem",color:"#22c55e"}}>{saved}</span>
      </div>
      <p style={{color:"#64748b",fontSize:"0.72rem",marginBottom:"0.75rem"}}>Drinks International Bestselling Classics 2026</p>

      {authReady && (
        <div style={frame({borderRadius:12,padding:"0.75rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",flexWrap:"wrap",rowGap:"0.6rem"})}>
          {user ? (
            <>
              <div style={{display:"flex",alignItems:"center",gap:"0.6rem",minWidth:0}}>
                {user.photoURL && <img src={user.photoURL} alt="" style={{width:28,height:28,borderRadius:"50%"}} />}
                <div style={{fontSize:"0.8rem",color:"#cbd5e1",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.displayName || user.email}</div>
              </div>
              <button onClick={signOutUser} style={{background:"transparent",border:"1px solid #33415560",color:"#94a3b8",borderRadius:8,padding:"0.4rem 0.7rem",fontSize:"0.75rem",cursor:"pointer"}}>Sign out</button>
            </>
          ) : (
            <>
              <div style={{fontSize:"0.8rem",color:"#94a3b8"}}>{firebaseEnabled ? "Sign in to sync progress" : "Cloud sync not configured"}</div>
              <div style={{display:"flex",flexDirection:"column",gap:"0.4rem"}}>
                <button onClick={() => signIn(googleProvider)} disabled={!firebaseEnabled} style={{background:firebaseEnabled?"#ffffff":"#334155",color:firebaseEnabled?"#1f2937":"#64748b",border:"none",borderRadius:8,padding:"0.4rem 0.75rem",fontSize:"0.8rem",fontWeight:600,cursor:firebaseEnabled?"pointer":"not-allowed"}}>🔐 Sign in with Google</button>
                {FACEBOOK_LOGIN_ENABLED && <button onClick={signInFacebook} disabled={!firebaseEnabled} style={{background:firebaseEnabled?"#1877F2":"#334155",color:firebaseEnabled?"#ffffff":"#64748b",border:"none",borderRadius:8,padding:"0.4rem 0.75rem",fontSize:"0.8rem",fontWeight:600,cursor:firebaseEnabled?"pointer":"not-allowed"}}>Sign in with Facebook</button>}
                {firebaseEnabled && (
                  <button onClick={() => { setShowEmailForm(v => !v); setEmailErr(""); }} aria-expanded={showEmailForm} style={{background:"transparent",border:"none",color:"#64748b",fontSize:"0.68rem",cursor:"pointer",padding:"0.1rem 0",textDecoration:"underline",alignSelf:"center"}}>
                    {showEmailForm ? "Cancel" : "Use email instead"}
                  </button>
                )}
              </div>
              {showEmailForm && firebaseEnabled && (
                <form onSubmit={signInEmail} style={{flexBasis:"100%",display:"flex",flexWrap:"wrap",gap:"0.4rem",alignItems:"center",borderTop:"1px solid #33415560",paddingTop:"0.6rem"}}>
                  <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="Email" required autoComplete="username" style={emailField} />
                  <input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} placeholder="Password" required autoComplete="current-password" style={emailField} />
                  <button type="submit" disabled={emailBusy} style={{background:emailBusy?"#334155":"#475569",color:emailBusy?"#64748b":"#e2e8f0",border:"none",borderRadius:8,padding:"0.4rem 0.75rem",fontSize:"0.8rem",fontWeight:600,cursor:emailBusy?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
                    {emailBusy ? "Signing in…" : "Sign in"}
                  </button>
                  {emailErr && <div role="alert" style={{flexBasis:"100%",color:"#f87171",fontSize:"0.7rem"}}>{emailErr}</div>}
                </form>
              )}
            </>
          )}
        </div>
      )}

      {FEATURES.stripePurchase && firebaseEnabled && authReady && !adFree && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",gap:"0.75rem"})}>
          <div style={{fontSize:"0.8rem",color:"#94a3b8"}}>Remove ads with a one-time purchase</div>
          <button onClick={startCheckout} disabled={purchasing || !user} style={{background:user?"#22c55e":"#334155",color:user?"#0f172a":"#64748b",border:"none",borderRadius:8,padding:"0.5rem 0.9rem",fontSize:"0.8rem",fontWeight:700,cursor:user?"pointer":"not-allowed",whiteSpace:"nowrap"}}>
            {purchasing ? "Redirecting…" : "🚫 Remove Ads — $12.99"}
          </button>
        </div>
      )}
      {/* Play (Capacitor) build: RevenueCat paywall + restore. */}
      {FEATURES.nativePurchase && !adFree && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",gap:"0.75rem"})}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:"0.8rem",color:"#94a3b8"}}>
              {firebaseEnabled && !user ? "Sign in, then go Pro — it carries over to the web" : "Cocktail Flashcards Pro — remove ads for good"}
            </div>
            <button onClick={restoreAdsNative} style={{background:"transparent",border:"none",color:"#64748b",fontSize:"0.72rem",cursor:"pointer",padding:"0.2rem 0",textDecoration:"underline"}}>Restore purchase</button>
          </div>
          {/* Held shut until RevenueCat's app-user id is confirmed to be this
              uid — a purchase started before that lands on the wrong id and can
              never be attributed to the account. */}
          {(() => {
            const awaitingIdentity = firebaseEnabled && Boolean(user) && linkedUid !== user.uid;
            const blocked = purchasing || awaitingIdentity;
            return (
              <button onClick={buyRemoveAdsNative} disabled={blocked} style={{background:blocked?"#334155":"#22c55e",color:blocked?"#64748b":"#0f172a",border:"none",borderRadius:8,padding:"0.5rem 0.9rem",fontSize:"0.8rem",fontWeight:700,cursor:blocked?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
                {purchasing ? "Processing…" : awaitingIdentity ? "Connecting…" : "✨ Go Pro"}
              </button>
            );
          })()}
        </div>
      )}
      {/* Already Pro in the Play build: Customer Center handles restore, refund
          requests, and subscription management without a support email. */}
      {FEATURES.nativePurchase && adFree && adsRemovedNative && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",gap:"0.75rem"})}>
          <div style={{fontSize:"0.8rem",color:"#94a3b8"}}>✨ Cocktail Flashcards Pro is active</div>
          <button onClick={openCustomerCenter} style={{background:"transparent",border:"1px solid #33415560",color:"#94a3b8",borderRadius:8,padding:"0.5rem 0.9rem",fontSize:"0.8rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
            Manage purchase
          </button>
        </div>
      )}
      {purchaseMsg && (
        <div style={{fontSize:"0.75rem",color:"#94a3b8",marginBottom:"1rem",marginTop:"-0.75rem"}}>{purchaseMsg}</div>
      )}

      {isAdmin && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",marginBottom:"1.25rem"})}>
          <button onClick={()=>setShowAdAdmin(s=>!s)} style={{background:"transparent",border:"none",color:"#f59e0b",fontWeight:700,fontSize:"0.85rem",cursor:"pointer",padding:0}}>
            🛡️ Ad Whitelist (admin) {showAdAdmin ? "▲" : "▼"}
          </button>
          {showAdAdmin && (
            <div style={{marginTop:"0.75rem"}}>
              <div style={{display:"flex",gap:"0.5rem",marginBottom:"0.5rem"}}>
                <input
                  value={whitelistInput}
                  onChange={e=>setWhitelistInput(e.target.value)}
                  placeholder="user@gmail.com"
                  style={{flex:1,padding:"0.5rem 0.75rem",borderRadius:8,background:"#0f172a",border:"1px solid #334155",color:"#f1f5f9",fontSize:"0.85rem",outline:"none"}}
                />
                <button onClick={addToWhitelist} style={{...btn("#f59e0b"),padding:"0.5rem 0.9rem",fontSize:"0.8rem"}}>Add</button>
              </div>
              {whitelistMsg && <div style={{fontSize:"0.75rem",color:"#94a3b8",marginBottom:"0.5rem"}}>{whitelistMsg}</div>}
              <div style={{display:"flex",flexDirection:"column",gap:"0.4rem",maxHeight:160,overflowY:"auto"}}>
                {whitelist.length === 0 && <div style={{color:"#64748b",fontSize:"0.8rem"}}>No whitelisted users yet.</div>}
                {whitelist.map(w => (
                  <div key={w.email} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#0f172a",borderRadius:8,padding:"0.4rem 0.6rem"}}>
                    <span style={{fontSize:"0.8rem",color:"#cbd5e1"}}>{w.email}</span>
                    <button onClick={()=>removeFromWhitelist(w.email)} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:"0.75rem"}}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.75rem",marginBottom:"1.25rem"}}>
        {[["Learned",learned,"#22c55e"],["Active",st.active.length,"#3b82f6"],["Total",total,"#f59e0b"]].map(([l,v,c])=>(
          <div key={l} style={frame({borderRadius:12,padding:"0.9rem",textAlign:"center"})}>
            <div style={{fontSize:"1.75rem",fontWeight:800,color:c}}>{v}</div>
            <div style={{fontSize:"0.75rem",color:"#94a3b8",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      <div style={frame({borderRadius:99,height:8,marginBottom:"1.75rem",overflow:"hidden"})}>
        <div style={{background:"#22c55e",height:"100%",width:`${(learned/total)*100}%`,transition:"width 0.5s"}} />
      </div>

      <button onClick={()=>{setDi(0);setRevealed(false);setMode("study");}} style={{...btn("#3b82f6"),width:"100%",marginBottom:"0.75rem"}}>📚 Study Mode</button>
      <button onClick={startQuiz} style={{...btn("#7c3aed"),width:"100%",marginBottom:"0.75rem"}}>🎯 Quiz — All {total} Cocktails</button>
      <button onClick={()=>{setSearch("");setMode("index");}} style={{...btn("#0891b2"),width:"100%",marginBottom:"1.5rem"}}>🔍 Index — Search Cocktails</button>

      <div style={frame({borderRadius:12,padding:"1rem 1.25rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"0.75rem"})}>
        <div>
          <div style={{fontWeight:700,color:"#f8fafc"}}>Master Mode</div>
          <div style={{fontSize:"0.75rem",color:"#94a3b8"}}>Expand pool to 200 cocktails</div>
        </div>
        <button onClick={toggleMaster} style={{width:52,height:28,borderRadius:99,border:"none",cursor:"pointer",position:"relative",background:st.masterMode?"#f59e0b":"#334155",transition:"background 0.3s"}}>
          <div style={{position:"absolute",top:3,left:st.masterMode?27:3,width:22,height:22,borderRadius:"50%",background:"#fff",transition:"left 0.3s"}} />
        </button>
      </div>
      <button onClick={reset} style={{width:"100%",padding:"0.6rem",borderRadius:8,background:"transparent",color:"#ef4444",fontWeight:600,fontSize:"0.85rem",border:"1px solid #ef444440",cursor:"pointer"}}>Reset Progress</button>
      <div style={{textAlign:"center",marginTop:"1rem",fontSize:"0.75rem",color:"#64748b"}}>
        Questions or feedback? <a href="mailto:steve@baroqueplusplus.com" style={{color:"#94a3b8"}}>steve@baroqueplusplus.com</a>
      </div>
      {/* Play requires the policy to be reachable from inside the app, not just
          from the store listing. Served as a static page, so it renders even if
          the app bundle fails. Withdrawing consent must be as easy as giving it,
          hence the second link — on Android it opens Google's own UMP privacy
          form instead, since that's where the choice was made. */}
      <div style={{textAlign:"center",marginTop:"0.5rem",fontSize:"0.75rem",color:"#64748b",display:"flex",gap:"0.75rem",justifyContent:"center",flexWrap:"wrap"}}>
        <a href="/privacy" style={{color:"#64748b"}}>Privacy Policy</a>
        {FEATURES.ads && gdprApplies && (
          <button onClick={openPrivacySettings} style={{background:"transparent",border:"none",color:"#64748b",fontSize:"0.75rem",cursor:"pointer",padding:0,textDecoration:"underline"}}>
            Privacy &amp; cookie settings
          </button>
        )}
        {FEATURES.nativeAds && privacyOptionsRequired && (
          <button onClick={openAdPrivacyOptions} style={{background:"transparent",border:"none",color:"#64748b",fontSize:"0.75rem",cursor:"pointer",padding:0,textDecoration:"underline"}}>
            Ad privacy options
          </button>
        )}
      </div>
    </div></div>
  );

  if (mode === "index") {
    const q = norm(search.trim());
    // Match on both the cocktail name and its ingredient list, accent-insensitively,
    // so "pina" finds "Piña Colada" and "rum" finds every drink containing rum.
    const results = q ? ALL_200.filter(c => norm(c.name).includes(q) || norm(c.ingredients).includes(q)) : ALL_200;
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:"#94a3b8",cursor:"pointer"}}>← Menu</button>
          <span style={{color:"#94a3b8",fontSize:"0.85rem"}}>{results.length} of {ALL_200.length}</span>
        </div>
        <input
          autoFocus
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Search name or ingredient…"
          style={frame({width:"100%",boxSizing:"border-box",padding:"0.85rem 1rem",borderRadius:12,border:"1px solid #334155",color:"#f1f5f9",fontSize:"1rem",marginBottom:"1.25rem",outline:"none"})}
        />
        <div style={{display:"flex",flexDirection:"column",gap:"0.75rem",maxHeight:"60vh",overflowY:"auto"}}>
          {results.length === 0 && (
            <div style={{color:"#64748b",textAlign:"center",padding:"2rem 0"}}>No cocktails found.</div>
          )}
          {results.map(c=>(
            <div key={c.name} style={frame({borderRadius:14,padding:"1rem 1.25rem"})}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.4rem",gap:"0.5rem"}}>
                <h3 style={{fontSize:"1.1rem",fontWeight:800,color:"#f8fafc",margin:0}}>{c.name}</h3>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:"0.35rem"}}>
                  {c.rank && <span style={{fontSize:"0.7rem",color:"#f59e0b",fontWeight:600,whiteSpace:"nowrap"}}>#{c.rank}</span>}
                  <button onClick={()=>toggleStudy(c.name)} style={{whiteSpace:"nowrap",borderRadius:8,padding:"0.3rem 0.6rem",fontSize:"0.72rem",fontWeight:700,cursor:"pointer",border:st.active.includes(c.name)?"none":"1px solid #3b82f680",background:st.active.includes(c.name)?"#16a34a":"transparent",color:st.active.includes(c.name)?"#fff":"#60a5fa"}}>
                    {st.active.includes(c.name) ? "✓ In Study" : "＋ Study"}
                  </button>
                </div>
              </div>
              <div style={{color:"#cbd5e1",lineHeight:1.7,fontSize:"0.85rem"}}>
                {c.glass && <div style={{padding:"0.05rem 0",borderBottom:"1px solid #ffffff0d",color:"#94a3b8"}}>{glassIcon(c.glass)} {c.glass} • {getMethod(c)}</div>}
                {c.ingredients.split(", ").map((g,i,a)=>(
                  <div key={i} style={{padding:"0.05rem 0",borderBottom:i<a.length-1?"1px solid #ffffff0d":"none"}}>{g}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div></div>
    );
  }

  if (mode === "study") {
    if (st.active.length === 0) {
      const allMastered = learned >= total;
      return (
        <div style={{...page,justifyContent:"center"}}>
          <div style={{fontSize:"3rem",marginBottom:"1rem"}}>{allMastered ? "🏆" : "🃏"}</div>
          <h2 style={{fontWeight:800,marginBottom:"0.5rem"}}>{allMastered ? "All Mastered!" : "Your deck is empty"}</h2>
          <p style={{color:"#94a3b8",marginBottom:"2rem",textAlign:"center"}}>
            {allMastered ? `You've learned all ${total} cocktails.` : "Add some cocktails from the Index to start studying."}
          </p>
          <div style={{display:"flex",gap:"0.75rem"}}>
            {!allMastered && <button onClick={()=>{setSearch("");setMode("index");}} style={btn("#0891b2",{padding:"0.75rem 1.5rem"})}>🔍 Index</button>}
            <button onClick={()=>setMode("menu")} style={btn("#3b82f6",{padding:"0.75rem 1.5rem"})}>Back to Menu</button>
          </div>
        </div>
      );
    }
    // Fall back to ALL_200 so cocktails added to the deck from the Index (which
    // may be outside the current mode's pool) still render.
    // Clamp here too, not just in the effect: a live sync can shrink the deck
    // and this render happens before the effect corrects the index.
    const cardIdx = Math.min(di, st.active.length - 1);
    const ci = st.active[cardIdx], c = pool.find(x => x.name === ci) || ALL_200.find(x => x.name === ci), score = st.scores[ci]||0;
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:"#94a3b8",cursor:"pointer"}}>← Menu</button>
          <span style={{color:"#94a3b8",fontSize:"0.85rem"}}>{learned}/{total} learned</span>
          <span style={{color:"#94a3b8",fontSize:"0.85rem"}}>Card {di+1}/{st.active.length}</span>
        </div>

        <div style={frame({borderRadius:20,padding:"2rem",marginBottom:"1.25rem",minHeight:280,display:"flex",flexDirection:"column",justifyContent:"space-between"})}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <h2 style={{fontSize:"1.5rem",fontWeight:800,color:"#f8fafc",margin:0,lineHeight:1.2}}>{c.name}</h2>
              {c.rank && <div style={{fontSize:"0.7rem",color:"#f59e0b",marginTop:"0.25rem",fontWeight:600}}>#{c.rank} DI 2026</div>}
            </div>
            <div style={{background:col(score),color:"#fff",borderRadius:99,padding:"0.2rem 0.6rem",fontSize:"0.85rem",fontWeight:700,whiteSpace:"nowrap",marginLeft:"0.75rem"}}>{score}/{MASTERY_SCORE}</div>
          </div>
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem 0"}}>
            {!revealed
              ? <button onClick={()=>setRevealed(true)} style={btn("#334155",{color:"#cbd5e1",fontSize:"0.95rem"})}>Reveal Ingredients</button>
              : <div style={{color:"#cbd5e1",lineHeight:1.85,fontSize:"0.9rem"}}>
                  {c.glass && <div style={{padding:"0.1rem 0",borderBottom:"1px solid #ffffff0d",color:"#94a3b8"}}>{glassIcon(c.glass)} {c.glass} • {getMethod(c)}</div>}
                  {c.ingredients.split(", ").map((g,i,a)=>(
                    <div key={i} style={{padding:"0.1rem 0",borderBottom:i<a.length-1?"1px solid #ffffff0d":"none"}}>{g}</div>
                  ))}
                </div>
            }
          </div>
        </div>

        {revealed
          ? <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem",marginBottom:"1rem"}}>
              <button onClick={()=>grade(true)} style={btn("#16a34a")}>✓ Got It</button>
              <button onClick={()=>grade(false)} style={btn("#dc2626")}>✗ Missed It</button>
            </div>
          : <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.75rem"}}>
              <button onClick={prev} style={btn("#1e293b",{color:"#94a3b8"})}>← Prev</button>
              <button onClick={shuffleActive} style={btn("#1e293b",{color:"#94a3b8"})}>🔀 Shuffle</button>
              <button onClick={next} style={btn("#1e293b",{color:"#94a3b8"})}>Next →</button>
            </div>
        }

        <div style={{display:"flex",gap:4,marginTop:"1.25rem",flexWrap:"wrap",justifyContent:"center"}}>
          {st.active.map((ci,i)=>(
            <div key={i} onClick={()=>{setDi(i);setRevealed(false);}}
              style={{width:28,height:28,borderRadius:6,background:i===di?"#3b82f6":"#1e293b",border:`2px solid ${col(st.scores[ci]||0)}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.65rem",color:"#94a3b8",fontWeight:700}}>
              {st.scores[ci]||0}
            </div>
          ))}
        </div>

        <div style={frame({borderRadius:12,padding:"0.85rem 1rem",marginTop:"1.25rem"})}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.5rem"}}>
            <div style={{fontSize:"0.8rem",fontWeight:700,color:"#cbd5e1"}}>Deck Size</div>
            <div style={{fontSize:"0.9rem",fontWeight:800,color:"#3b82f6"}}>{deckSize >= total ? "All" : deckSize}</div>
          </div>
          <div style={{display:"flex",gap:"0.4rem"}}>
            {[10,20,30,50].map(n=>{
              const on = deckSize === n && deckSize < total;
              return <button key={n} onClick={()=>setDeckSizeTo(n)} style={{flex:1,padding:"0.45rem",borderRadius:8,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.8rem",background:on?"#3b82f6":"#1e293b",color:on?"#fff":"#94a3b8"}}>{n}</button>;
            })}
            <button onClick={()=>setDeckSizeTo(total)} style={{flex:1,padding:"0.45rem",borderRadius:8,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.8rem",background:deckSize>=total?"#3b82f6":"#1e293b",color:deckSize>=total?"#fff":"#94a3b8"}}>All</button>
          </div>
        </div>
      </div></div>
    );
  }

  if (mode === "quiz") {
    const c = quizPool[qi];
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:"#94a3b8",cursor:"pointer"}}>← Menu</button>
          <span style={{color:"#94a3b8",fontSize:"0.85rem"}}>{qi+1} / {quizPool.length}</span>
          <span style={{color:"#22c55e",fontWeight:700}}>{qa.filter(Boolean).length} ✓</span>
        </div>
        <div style={frame({borderRadius:99,height:6,marginBottom:"1.5rem",overflow:"hidden"})}>
          <div style={{background:"#7c3aed",height:"100%",width:`${(qi/quizPool.length)*100}%`,transition:"width 0.3s"}} />
        </div>
        <div style={frame({borderRadius:20,padding:"2rem",marginBottom:"1.25rem",minHeight:280,display:"flex",flexDirection:"column",justifyContent:"space-between"})}>
          <div>
            <h2 style={{fontSize:"1.5rem",fontWeight:800,color:"#f8fafc",margin:0}}>{c.name}</h2>
            {c.rank && <div style={{fontSize:"0.7rem",color:"#f59e0b",marginTop:"0.25rem",fontWeight:600}}>#{c.rank} DI 2026</div>}
          </div>
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem 0"}}>
            {!qr
              ? <button onClick={()=>setQr(true)} style={btn("#334155",{color:"#cbd5e1",fontSize:"0.95rem"})}>Reveal Ingredients</button>
              : <div style={{color:"#cbd5e1",lineHeight:1.85,fontSize:"0.9rem"}}>
                  {c.glass && <div style={{padding:"0.1rem 0",borderBottom:"1px solid #ffffff0d",color:"#94a3b8"}}>{glassIcon(c.glass)} {c.glass} • {getMethod(c)}</div>}
                  {c.ingredients.split(", ").map((g,i,a)=>(
                    <div key={i} style={{padding:"0.1rem 0",borderBottom:i<a.length-1?"1px solid #ffffff0d":"none"}}>{g}</div>
                  ))}
                </div>
            }
          </div>
        </div>
        {qr && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
            <button onClick={()=>qGrade(true)} style={btn("#16a34a")}>✓ Knew It</button>
            <button onClick={()=>qGrade(false)} style={btn("#dc2626")}>✗ Didn't Know</button>
          </div>
        )}
      </div></div>
    );
  }

  if (mode === "results") {
    const knew = qa.filter(Boolean).length;
    const pct = Math.round((knew/quizPool.length)*100);
    const missed = quizPool.filter((_,i)=>qa[i]===false);
    return (
      <div style={page}><div style={wrap}>
        <div style={{textAlign:"center",marginBottom:"2rem"}}>
          <div style={{fontSize:"3rem",marginBottom:"0.5rem"}}>{pct>=80?"🏆":pct>=50?"📚":"💪"}</div>
          <h2 style={{fontSize:"2rem",fontWeight:800,margin:"0 0 0.5rem"}}>{pct}%</h2>
          <p style={{color:"#94a3b8"}}>You knew {knew} out of {quizPool.length} cocktails</p>
        </div>
        {missed.length > 0 && (
          <div style={frame({borderRadius:16,padding:"1.25rem",marginBottom:"1.5rem",maxHeight:280,overflowY:"auto"})}>
            <h3 style={{fontWeight:700,marginTop:0,color:"#f87171",fontSize:"0.9rem",textTransform:"uppercase",letterSpacing:"0.05em"}}>Needs Work ({missed.length})</h3>
            <div style={{display:"flex",flexWrap:"wrap",gap:"0.4rem"}}>
              {missed.map(c=>(
                <span key={c.name} style={{background:"#dc262620",border:"1px solid #dc262660",color:"#fca5a5",borderRadius:6,padding:"0.2rem 0.5rem",fontSize:"0.8rem"}}>{c.name}</span>
              ))}
            </div>
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
          <button onClick={startQuiz} style={btn("#7c3aed")}>Retry Quiz</button>
          <button onClick={()=>setMode("menu")} style={btn("#1e293b")}>Menu</button>
        </div>
      </div></div>
    );
  }
}

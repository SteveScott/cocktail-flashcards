import { useState, useEffect } from "react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  auth, db, googleProvider, facebookProvider, firebaseEnabled,
  isEmailAdWhitelisted, addEmailToAdWhitelist, removeEmailFromAdWhitelist, listAdWhitelist,
} from "./firebase";
import cocktailData from './cocktails.json';

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
  return { scores, active: pool.slice(0, Math.min(DECK_SIZE, pool.length)).map(c => c.name), masterMode, learned: [] };
}

function refillDeck(st, pool) {
  const lSet = new Set(st.learned), aSet = new Set(st.active);
  const avail = pool.map(c => c.name).filter(n => !lSet.has(n) && !aSet.has(n));
  const na = [...st.active];
  while (na.length < DECK_SIZE && avail.length > 0) na.push(avail.shift());
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
  return refillDeck({ scores, learned, active, masterMode }, pool);
}

export default function App() {
  const [st, setSt] = useState(() => loadLocal() || initState(false));
  const [mode, setMode] = useState("menu");
  const [di, setDi] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [qa, setQa] = useState([]);
  const [qi, setQi] = useState(0);
  const [qr, setQr] = useState(false);
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
  const [adsRemoved, setAdsRemoved] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseMsg, setPurchaseMsg] = useState("");
  const adFree = adWhitelisted || adsRemoved;

  const isAdmin = firebaseEnabled && Boolean(user?.email) && ADMIN_EMAILS.includes(user.email.toLowerCase());

  const pool = st.masterMode ? ALL_200 : top50;
  const learned = st.learned?.length || 0;
  const total = pool.length;

  useEffect(() => {
    saveLocal(st);
    setSaved("✓"); setTimeout(() => setSaved(""), 1200);
  }, [st]);

  // Complete a redirect-based sign-in if one is in progress (fallback for when the popup gets closed early).
  useEffect(() => {
    if (!firebaseEnabled) return;
    getRedirectResult(auth).catch(e => console.error("Redirect sign-in failed", e));
  }, []);

  // Watch Google sign-in state; on login, merge cloud progress with local progress.
  useEffect(() => {
    if (!firebaseEnabled) return;
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, "users", u.uid));
          const data = snap.exists() ? snap.data() : null;
          const cloud = data?.progress || null;
          setAdsRemoved(Boolean(data?.adsRemoved));
          let merged;
          setSt(prev => { merged = mergeStates(prev, cloud); return merged; });
          await setDoc(doc(db, "users", u.uid), { progress: merged, updatedAt: Date.now() }, { merge: true });
        } catch (e) { console.error("Cloud sync failed", e); }
      } else {
        setAdsRemoved(false);
      }
      setAuthReady(true);
    });
    return unsub;
  }, []);

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
              setAdsRemoved(true);
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
      setDoc(doc(db, "users", user.uid), { progress: st, updatedAt: Date.now() }).catch(e => console.error("Cloud save failed", e));
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
  useEffect(() => {
    if (!adCheckDone || adFree) return;
    loadAdsenseScript();
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
    const cur = di;
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
  function startQuiz() { setQa([]); setQi(0); setQr(false); setMode("quiz"); }
  function qGrade(k) {
    const ans = [...qa, k];
    setQa(ans);
    if (qi+1 >= pool.length) setMode("results");
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

  const wrap = { maxWidth:480, width:"100%" };
  const page = { minHeight:"100dvh", background:"rgba(15, 23, 42, 0.2)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", color:"#f1f5f9", display:"flex", flexDirection:"column", alignItems:"center", padding:"1.5rem 1rem" };
  const btn = (bg, x={}) => ({ padding:"1rem", borderRadius:12, background:bg, color:"#fff", fontWeight:700, fontSize:"1rem", border:"none", cursor:"pointer", ...x });
  const FRAME_BG = "rgba(15, 23, 42, 0.55)";
  const frame = (x={}) => ({ background:FRAME_BG, backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", ...x });

  if (mode === "menu") return (
    <div style={page}><div style={wrap}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.15rem"}}>
        <h1 style={{fontSize:"1.8rem",fontWeight:800,margin:0,color:"#f8fafc"}}>🍹 Cocktail Flashcards</h1>
        <span style={{fontSize:"0.7rem",color:"#22c55e"}}>{saved}</span>
      </div>
      <p style={{color:"#64748b",fontSize:"0.72rem",marginBottom:"0.75rem"}}>Drinks International Bestselling Classics 2024</p>

      {authReady && (
        <div style={frame({borderRadius:12,padding:"0.75rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem"})}>
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
              </div>
            </>
          )}
        </div>
      )}

      {firebaseEnabled && authReady && !adFree && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",gap:"0.75rem"})}>
          <div style={{fontSize:"0.8rem",color:"#94a3b8"}}>Remove ads with a one-time purchase</div>
          <button onClick={startCheckout} disabled={purchasing || !user} style={{background:user?"#22c55e":"#334155",color:user?"#0f172a":"#64748b",border:"none",borderRadius:8,padding:"0.5rem 0.9rem",fontSize:"0.8rem",fontWeight:700,cursor:user?"pointer":"not-allowed",whiteSpace:"nowrap"}}>
            {purchasing ? "Redirecting…" : "🚫 Remove Ads — $12.99"}
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
    </div></div>
  );

  if (mode === "index") {
    const q = search.trim().toLowerCase();
    const results = q ? ALL_200.filter(c => c.name.toLowerCase().includes(q)) : ALL_200;
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
          placeholder="Search cocktail name…"
          style={frame({width:"100%",boxSizing:"border-box",padding:"0.85rem 1rem",borderRadius:12,border:"1px solid #334155",color:"#f1f5f9",fontSize:"1rem",marginBottom:"1.25rem",outline:"none"})}
        />
        <div style={{display:"flex",flexDirection:"column",gap:"0.75rem",maxHeight:"60vh",overflowY:"auto"}}>
          {results.length === 0 && (
            <div style={{color:"#64748b",textAlign:"center",padding:"2rem 0"}}>No cocktails found.</div>
          )}
          {results.map(c=>(
            <div key={c.name} style={frame({borderRadius:14,padding:"1rem 1.25rem"})}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.4rem"}}>
                <h3 style={{fontSize:"1.1rem",fontWeight:800,color:"#f8fafc",margin:0}}>{c.name}</h3>
                {c.rank && <span style={{fontSize:"0.7rem",color:"#f59e0b",fontWeight:600,whiteSpace:"nowrap",marginLeft:"0.5rem"}}>#{c.rank}</span>}
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
    if (st.active.length === 0) return (
      <div style={{...page,justifyContent:"center"}}>
        <div style={{fontSize:"3rem",marginBottom:"1rem"}}>🏆</div>
        <h2 style={{fontWeight:800,marginBottom:"0.5rem"}}>All Mastered!</h2>
        <p style={{color:"#94a3b8",marginBottom:"2rem"}}>You've learned all {total} cocktails.</p>
        <button onClick={()=>setMode("menu")} style={btn("#3b82f6",{padding:"0.75rem 2rem"})}>Back to Menu</button>
      </div>
    );
    const ci = st.active[di], c = pool.find(x => x.name === ci), score = st.scores[ci]||0;
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
              {c.rank && <div style={{fontSize:"0.7rem",color:"#f59e0b",marginTop:"0.25rem",fontWeight:600}}>#{c.rank} DI 2024</div>}
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
          : <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
              <button onClick={prev} style={btn("#1e293b",{color:"#94a3b8"})}>← Prev</button>
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
      </div></div>
    );
  }

  if (mode === "quiz") {
    const c = pool[qi];
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:"#94a3b8",cursor:"pointer"}}>← Menu</button>
          <span style={{color:"#94a3b8",fontSize:"0.85rem"}}>{qi+1} / {pool.length}</span>
          <span style={{color:"#22c55e",fontWeight:700}}>{qa.filter(Boolean).length} ✓</span>
        </div>
        <div style={frame({borderRadius:99,height:6,marginBottom:"1.5rem",overflow:"hidden"})}>
          <div style={{background:"#7c3aed",height:"100%",width:`${(qi/pool.length)*100}%`,transition:"width 0.3s"}} />
        </div>
        <div style={frame({borderRadius:20,padding:"2rem",marginBottom:"1.25rem",minHeight:280,display:"flex",flexDirection:"column",justifyContent:"space-between"})}>
          <div>
            <h2 style={{fontSize:"1.5rem",fontWeight:800,color:"#f8fafc",margin:0}}>{c.name}</h2>
            {c.rank && <div style={{fontSize:"0.7rem",color:"#f59e0b",marginTop:"0.25rem",fontWeight:600}}>#{c.rank} DI 2024</div>}
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
    const pct = Math.round((knew/pool.length)*100);
    const missed = pool.filter((_,i)=>qa[i]===false);
    return (
      <div style={page}><div style={wrap}>
        <div style={{textAlign:"center",marginBottom:"2rem"}}>
          <div style={{fontSize:"3rem",marginBottom:"0.5rem"}}>{pct>=80?"🏆":pct>=50?"📚":"💪"}</div>
          <h2 style={{fontSize:"2rem",fontWeight:800,margin:"0 0 0.5rem"}}>{pct}%</h2>
          <p style={{color:"#94a3b8"}}>You knew {knew} out of {pool.length} cocktails</p>
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

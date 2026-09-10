/* global __BUILD_TIME__ */ // injected by vite.config.js — see the build stamp in the billing diagnostics
import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import {
  auth, db, googleProvider, facebookProvider, firebaseEnabled,
  isEmailAdWhitelisted, addEmailToAdWhitelist, removeEmailFromAdWhitelist, listAdWhitelist,
} from "./firebase";
import cocktailData from './cocktails.json';
import { restoreProgress } from "./admin-restore.js";
import { mergeProgress, growsFrom, sameProgress } from "./progress-merge.js";
import { FEATURES } from './platform';
import { nativeGoogleSignInAvailable, signInWithGoogleNative, signOutGoogleNative, signInFailureText, isSignInCancellation } from './native-auth';
import { norm, getMethod, buildLexicon, buildEightySixQuestion, eightySixEligible } from './recipe-meta';
import { openPrivacySettings, onGdprApplicable } from './consent';
import { loadAds, isAdNetworkConfigured, areAdsServing, onAdsServing } from './ads';
import AdSlot from './AdSlot.jsx';
import {
  initMonetization, showBanner, hideBanner, purchaseRemoveAds, restorePurchases,
  linkRevenueCatUser, unlinkRevenueCatUser, onEntitlementChange,
  presentPaywall, presentCustomerCenter, isBillingAvailable, isUserCancelled,
  PAYWALL_OUTCOME, getAdConsentState, showAdPrivacyOptions, getBillingDiagnostics,
} from './monetization';

const { top50, master150 } = cocktailData;

// Whether RevenueCat actually has an SDK key behind it. Deliberately NOT the
// same question as FEATURES.nativePurchase: that only says we're in the Play
// shell, while the key is inlined from the env of the build that reaches users
// — Netlify's, since the shell loads the deployed site (see
// docs/mobile-monetization.md). With the key absent every purchase call fails,
// so the Pro UI is hidden outright rather than shown as a button whose only
// possible answer is "purchases aren't available in this build".
const billingReady = isBillingAvailable();

// What the web checkout charges, for display only — Stripe is the authority on
// what is actually taken. It lives here as one constant so the label cannot
// drift from itself, but it CANNOT keep the storefronts in step: the real price
// lives in a Stripe Price object and in the Play `lifetime` product, and both
// are edited in their own dashboards. Change the price in all three, together.
// The Play build never reads this — RevenueCat's paywall shows Google's own
// localised price, which is why only the web needs a hardcoded string at all.
const PRO_PRICE = "$7.99";

// Every cocktail in the book. The free tier studies and quizzes the top 50 of
// them; the rest is what a Pro purchase adds — see poolFor() below.
const ALL_CARDS = [...top50, ...master150];

// The vocabulary of the corpus and the distribution the 86 It quiz samples wrong
// answers from. Built once — the lexicon never changes at runtime. Deliberately
// the whole corpus and not the player's pool: an impostor is an ingredient name,
// not a recipe, and drawing them from 50 drinks would make the free game easier
// rather than smaller.
const LEXICON = buildLexicon(ALL_CARDS);

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

// Every screen below is styled inline rather than from a stylesheet, so the
// palette lives here and each colour is a reference into it — there are no
// loose hex values further down.
//
// Two schemes. RETRO is the default: hues read off the bar photograph the app
// is laid over (src/assets/bg-cocktails.jpg) — walnut, whiskey and back-bar
// brass. FUTURE is the same room after hours, in cyan and magenta on near-black
// blue. They share every key, which is the whole point — a screen asks for
// C.danger and gets oxblood or hot magenta depending on which is on, and no
// screen has to know which that is.
//
// Which is why every key here is named for its JOB and never for its colour.
// The schemes do not agree on hue family, so a colour name is false in one of
// them by construction: what `brass` named is gold in Retro and cyan in Future,
// `cognac` is brown then teal, `oxblood` dark red then hot magenta. Naming the
// slot `danger` is true in both, and a screen picking a colour by what it means
// cannot pick one that the other scheme contradicts.
//
// Keep these in step with the tokens in src/index.css, which dress the page
// around the app and carry the two font stacks.

const THEMES = {
  retro: {
    name: "Retro",
    // The menu stack is one gradient. All four buttons are a single sweep of hue
    // at FIXED lightness and chroma (L* 0.51, C 0.087 in OKLCH), four stops 30°
    // apart running amber → copper → red → plum. Holding lightness is what makes
    // that safe rather than merely pretty — the label colour is fixed, so a ramp
    // that darkened or lightened as it went would starve one end of contrast.
    // These sit at 5.5:1 to 5.6:1 against textOnFill, comfortably past AA, and
    // vary only in the one channel that carries no contrast.
    //
    // The stops are listed in menu order and the hue must stay monotonic down
    // the stack — that ordering IS the gradient. Reordering the buttons without
    // reordering these turns the sweep back into four unrelated colours, which
    // is what it looked like before.
    //
    // Which puts Index on the loud end of the ramp, and that is the right way
    // round: it is the one mode that shows the whole book to everyone, paywall
    // or not, so it is the button worth drawing the eye. If the ramp is ever
    // reversed, reverse it in both schemes — Index earns the end stop, not a
    // particular hue.
    navStudy:        "#865c28",   // amber     h=70
    navQuiz:         "#90543f",   // copper    h=40
    navEightySix:    "#90505b",   // red       h=10
    navIndex:        "#875176",   // plum      h=340

    well:            "#17100a",   // darkest wood: wells, input fields, text on brass
    surfaceQuiet:    "#2b1c0d",   // quiet button faces
    surfaceDisabled: "#3a2a17",   // disabled faces
    border:          "#d6b46a38", // brass hairline — the deco pinstripe
    borderStrong:    "#d6b46a55",
    borderFaint:     "#d6b46a1f", // the divider between ingredient lines

    textStrong:      "#f6ecd9",   // headings
    textBody:        "#e2d2b6",   // body copy
    textMuted:       "#b09a78",   // labels and secondary text
    textFaint:       "#97815f",   // captions and footnotes, and the lowest mastery rung
    textGhost:       "#6b5940",   // the quietest links
    textOnFill:      "#fdf6e8",   // text on a saturated button

    accent:          "#d6b46a",   // Pro, ranks, the primary accent
    accentEdge:      "#d6b46a55",
    accentSoft:      "#d6b46a3d",

    success:         "#5f9d6b",   // learned, correct, mastered
    successDeep:     "#417a50",   // "Got It", "Check Answer"
    successWash:     "#5f9d6b26",
    successEdge:     "#5f9d6b80",

    danger:          "#9a3540",   // missed, destructive
    dangerDeep:      "#6d2530",
    dangerWash:      "#9a354026",
    dangerEdge:      "#9a354066",
    dangerLine:      "#9a354080",
    dangerText:      "#c4626a",   // destructive text on a dark ground
    dangerTextEdge:  "#c4626a40",
    dangerLite:      "#dda3a6",   // "IMPOSTOR" and the needs-work chips
    error:           "#d2848a",   // error messages

    info:            "#2f7079",   // the active deck, informational
    masteryMid:      "#3d8892",   // the mid rung of the mastery scale
    infoLite:        "#78b3ba",
    infoWash:        "#4d949e26",
    infoEdge:        "#4d949e80",


    accentAlt:       "#7a4464",   // the tried marker
    accentAltDeep:   "#4a2740",
    // The outline and label of an unticked Tried chip. Deliberately rosier than
    // the plum they sit against: a true tint of it comes out lilac, and one cold
    // chip on a card is enough to pull the whole screen back toward the old
    // scheme.
    accentAltEdge:   "#9c6a7555",
    accentAltLite:   "#c89aa4",

    // Both sit over the bar photo, so they are tints and not fills: the frame is
    // the panel a card or a row is printed on, the page the wash behind them.
    surfaceCard:     "rgba(26, 17, 9, 0.62)",
    surfacePage:     "rgba(26, 17, 9, 0.28)",
    // Typographic knobs. Inline styles beat the stylesheet, so anything the
    // scheme wants to change about a heading or a button label has to travel
    // with the palette rather than sit in a CSS rule that never wins.
    ui: {
      h1: { fontSize: "1.8rem", fontWeight: 800 },
      btn: {},
      glow: false,
    },
  },

  future: {
    name: "Future",
    // The same construction in Future's own spectrum: blue through violet and
    // purple to magenta, four stops 25° apart at L* 0.54 and C 0.225 — near the
    // most chroma sRGB will hold across this arc without clipping, so the neon
    // survives. 5.3:1 to 5.6:1. Menu order and monotonic, as in Retro.
    navStudy:        "#5154ed",   // blue      h=275
    navQuiz:         "#863dda",   // violet    h=300
    navEightySix:    "#aa26b4",   // purple    h=325
    navIndex:        "#c40181",   // magenta   h=350
    well:            "#05070f",   // near-black blue: wells, input fields, text on cyan
    surfaceQuiet:    "#0d1426",   // quiet button faces
    surfaceDisabled: "#182a4a",   // disabled faces
    border:          "#22d3ee3d", // cyan hairline
    borderStrong:    "#22d3ee5c",
    borderFaint:     "#22d3ee24", // the divider between ingredient lines

    textStrong:      "#eafcff",   // headings
    textBody:        "#c2e9f5",   // body copy
    textMuted:       "#7fa8c4",   // labels and secondary text
    textFaint:       "#5f83a2",   // captions and footnotes
    textGhost:       "#46607a",   // the quietest links
    textOnFill:      "#f2fdff",   // text on a saturated button

    accent:          "#22d3ee",   // Pro, ranks, the primary accent
    accentEdge:      "#22d3ee5c",
    accentSoft:      "#22d3ee40",

    success:         "#3dff92",   // learned, correct, mastered
    successDeep:     "#0a7d3e",   // "Got It", "Check Answer"
    successWash:     "#3dff9226",
    successEdge:     "#3dff9280",

    danger:          "#d1155e",   // missed, destructive
    dangerDeep:      "#7d0d39",
    dangerWash:      "#ff2d7a26",
    dangerEdge:      "#ff2d7a66",
    dangerLine:      "#ff2d7a80",
    dangerText:      "#ff5c96",   // destructive text on a dark ground
    dangerTextEdge:  "#ff5c9640",
    dangerLite:      "#ffa3c4",   // "IMPOSTOR" and the needs-work chips
    error:           "#ff7aad",   // error messages

    info:            "#2f5cff",   // the active deck, informational
    masteryMid:      "#4f8bff",   // the mid rung of the mastery scale
    infoLite:        "#8fb6ff",
    infoWash:        "#4f8bff26",
    infoEdge:        "#4f8bff80",

    accentAlt:       "#7b2fe0",   // the tried marker
    accentAltDeep:   "#45197d",
    accentAltEdge:   "#a78bfa5c",
    accentAltLite:   "#c9b3ff",

    surfaceCard:     "rgba(5, 9, 22, 0.66)",
    surfacePage:     "rgba(5, 9, 22, 0.34)",

    // The caps this used to set — 0.07em on the title, 0.09em on buttons — were
    // the scheme's voice, but they were also most of why it was hard to read:
    // tracked uppercase over a blurred photograph punishes any face. The glow
    // and the palette carry the voice now; the lettering just has to be read.
    //
    // 1.8rem matches Retro, so the title is the same words at the same size in
    // both schemes and only the face changes. It was 1.25rem to stop Orbitron
    // wrapping on a phone; Oxanium sets that string within a pixel of Playfair
    // at this size, so the row it shares with the save indicator still holds.
    ui: {
      h1: { fontSize: "1.8rem", fontWeight: 700, letterSpacing: "0.01em" },
      btn: { letterSpacing: "0.02em", fontSize: "0.92rem" },
      glow: true,
    },
  },
};

// How the scheme picker paints each choice. Literals rather than lookups into
// THEMES, because each button advertises the scheme it SELECTS and not the one
// currently running: a picker that restyled itself would only ever show you the
// answer you already have. The faces are named here too — the Future button is
// lettered in Oxanium whichever scheme is on, which is the whole point of it.
// It follows the scheme out of caps too: a button still shouting FUTURE would
// be advertising lettering the scheme no longer uses. The tracking stays, at
// the swatch's own 0.02em — it is a specimen, not a line of text to read.
const THEME_SWATCH = {
  retro: {
    label: "Retro", bg: "#8f5f2a", fg: "#fdf6e8", ring: "#d6b46a",
    font: "'Playfair Display', Georgia, serif",
    tracking: "0.02em", transform: "none", glow: "none",
  },
  future: {
    label: "Future", bg: "#2f5cff", fg: "#eafcff", ring: "#22d3ee",
    font: "'Oxanium', ui-sans-serif, system-ui, sans-serif",
    tracking: "0.02em", transform: "none", glow: "0 0 20px -4px #2f5cff",
  },
};

const THEME_KEY = "cocktail_theme_v1";
const DEFAULT_THEME = "retro";

// Read back the saved scheme. index.html has already applied it to <html> before
// first paint; this is React catching up to what the document is wearing.
function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t && THEMES[t] ? t : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
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

// The cocktails a progress state actually studies and quizzes from. Master Mode
// — the switch that adds the whole library — is the paid half of the product, so
// it only widens the pool when Pro is unlocked: a lapsed purchase, or an
// entitlement that hasn't loaded yet, falls back to the free top 50 rather than
// handing out paid cocktails.
function poolFor(st, pro) {
  return pro && st?.masterMode ? ALL_CARDS : top50;
}

// Fisher–Yates on a copy. Shared by both quizzes, which each need a fresh
// random order of the whole pool rather than its first n cocktails.
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function initState(masterMode) {
  const pool = masterMode ? ALL_CARDS : top50;
  const scores = {};
  pool.forEach(c => { scores[c.name] = 0; });
  return { scores, active: pool.slice(0, Math.min(DECK_SIZE, pool.length)).map(c => c.name), masterMode, learned: [], tried: [], deckSize: DECK_SIZE };
}

// Bring the study deck to exactly its chosen size, holding only cards the pool
// actually contains. Out of pool: dropped — that is what keeps paid cocktails
// out of a deck once the full library is switched off, and it costs nothing
// permanent, since scores and `learned` are left alone and the cards come back
// when the pool widens again. Too short: pad from the pool. Too long: truncate
// in order, dropping the cards past the limit. Trimming here — not only in the
// size picker — is what stops the cloud merge (a union of two devices' decks)
// from leaving an oversized deck.
function refillDeck(st, pool) {
  const target = st.deckSize || DECK_SIZE;
  const inPool = new Set(pool.map(c => c.name));
  const lSet = new Set(st.learned), aSet = new Set(st.active);
  const avail = pool.map(c => c.name).filter(n => !lSet.has(n) && !aSet.has(n));
  const na = st.active.filter(n => inPool.has(n)).slice(0, target);
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
  // Swallowed on purpose: localStorage throws when the quota is full or when a
  // privacy mode refuses it, and neither is worth interrupting study for. The
  // state is still live in memory, and a signed-in account has the cloud save
  // below as its real copy — this is the convenience one.
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* progress stays in memory */ }
}

// Merge two progress states (e.g. local device + cloud account) without losing
// progress either side made. `pro` is passed in rather than read from module
// state because it decides how wide the merged deck may be — see poolFor().
function mergeStates(a, b, pro) {
  if (!a) return b;
  if (!b) return a;
  const scores = { ...a.scores };
  for (const k in b.scores) scores[k] = Math.max(scores[k] || 0, b.scores[k] || 0);
  const learned = Array.from(new Set([...(a.learned||[]), ...(b.learned||[])]));
  // Tried is a union like learned: having drunk something on one device is a
  // fact that a second device cannot un-know.
  const tried = Array.from(new Set([...(a.tried||[]), ...(b.tried||[])]));
  const masterMode = a.masterMode || b.masterMode;
  const pool = poolFor({ masterMode }, pro);
  const lSet = new Set(learned);
  const active = Array.from(new Set([...(a.active||[]), ...(b.active||[])])).filter(n => !lSet.has(n));
  const deckSize = a.deckSize || b.deckSize || DECK_SIZE;
  return refillDeck({ scores, learned, tried, active, masterMode, deckSize }, pool);
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
  if (!sameList(a.tried, b.tried)) return false;
  const keys = new Set([...Object.keys(a.scores || {}), ...Object.keys(b.scores || {})]);
  for (const k of keys) if ((a.scores?.[k] || 0) !== (b.scores?.[k] || 0)) return false;
  return true;
}

// How long ago, in the coarsest unit that still says something. Only ever shown
// against the high-water mark's own updatedAt, which is a plain Date.now() from
// this same client (saveHighWater) — no server clock and no Firestore Timestamp
// to unwrap, so a rounded local difference is honest. Computed at render rather
// than ticked on a timer: nobody watches this line change.
function timeAgo(ts) {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return "moments ago";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// The two numbers from a high-water mark worth showing a person: how much it
// holds, in the same units the tiles above it count. Null for "there is no mark",
// which is a different statement from a mark holding nothing and has to stay
// tellable apart — the first is a new account, the second is the shape the bug
// left behind.
function peakCounts(progress) {
  if (!progress) return null;
  return { learned: progress.learned?.length || 0, tried: progress.tried?.length || 0 };
}

// Deliberately NOT drawn from C. Everything else on screen is walnut and brass
// because it is furniture in a dark room, but these are pyrotechnics and real
// ones are saturated — sodium gold, strontium red, barium green, copper blue,
// magnesium white. Toning them down to match the panelling is how a celebration
// stops reading as one, and they only ever appear over a 100% result.
const FIREWORK_COLORS = ["#ffc21a", "#ff3355", "#2bff85", "#22c8ff", "#b44cff", "#fff4d6"];
const FIREWORK_SPARKS = 12;
const BURST_MS = 2400;   // must match the .fw-spark / .fw-fall animation duration
const LAUNCH_MS = 520;   // gap between launches; ~5 bursts alive at any moment

// How Stripe Checkout hands its result back: ?purchase=success|cancelled on the
// return URL. Read once here, before the first render, because the app strips
// the parameter off the URL as soon as it mounts — so this is a one-shot input,
// not something a later render could look up again. Reading it at module scope
// is also what lets the message it produces be the initial state of purchaseMsg
// rather than something an effect has to set after the fact.
const CHECKOUT_RESULT = new URLSearchParams(window.location.search).get("purchase");

// Fireworks for a 100% quiz. Each burst is a fresh element launched on a timer
// at a random spot, so the display never repeats itself -- as opposed to a fixed
// set of shells on an infinite loop, where the eye picks out the cycle in a
// couple of seconds and it stops reading as fireworks.
function Fireworks() {
  const [bursts, setBursts] = useState([]);
  useEffect(() => {
    // Nothing to launch if the viewer asked for less motion -- the CSS hides the
    // overlay anyway, so without this we would churn state behind display:none.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let id = 0;
    // Colors come from a shuffled bag rather than an independent pick each time:
    // free choice lets the same color land three launches running, which looks
    // like a stuck palette. A bag guarantees all six appear before any repeats.
    let bag = [];
    const nextColor = () => {
      if (!bag.length) {
        bag = [...FIREWORK_COLORS];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      return bag.pop();
    };
    const launch = () => {
      const now = Date.now();
      const b = {
        id: id++,
        born: now,
        // Kept off the edges, and out of the bottom third where the buttons are.
        left: `${8 + Math.random() * 84}%`,
        top: `${8 + Math.random() * 60}%`,
        color: nextColor(),
        dist: `${52 + Math.random() * 40}px`,
      };
      // Spent bursts are pruned here rather than each on its own timeout, so the
      // interval is the only thing that ever needs cleaning up.
      setBursts(v => [...v.filter(x => now - x.born < BURST_MS), b]);
    };
    launch();
    const t = setInterval(launch, LAUNCH_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fw" aria-hidden="true">
      {bursts.map(b => (
        <div key={b.id} className="fw-shell" style={{left:b.left,top:b.top}}>
          {Array.from({length:FIREWORK_SPARKS},(_,j)=>(
            <div key={j} className="fw-spark" style={{"--fw-a":`${j*(360/FIREWORK_SPARKS)}deg`,"--fw-d":b.dist,"--fw-c":b.color}} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [st, setSt] = useState(() => loadLocal() || initState(false));
  // Which colour scheme is on. Deliberately NOT part of `st`: that object is
  // study progress and it syncs to Firestore, where a scheme chosen on a phone
  // would follow you to a desktop that never asked for it. This is a per-device
  // preference and stays in localStorage.
  const [theme, setTheme] = useState(loadTheme);
  const [mode, setMode] = useState("menu");
  const [di, setDi] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [qa, setQa] = useState([]);
  const [qi, setQi] = useState(0);
  const [qr, setQr] = useState(false);
  const [quizPool, setQuizPool] = useState([]);
  // How many questions the last quiz was started with, so "Retry Quiz" repeats
  // the same length instead of sending you back through the picker. null = all.
  const [quizLen, setQuizLen] = useState(null);
  // "self" (reveal and grade yourself) or "86" (uncheck what doesn't belong).
  const [quizKind, setQuizKind] = useState("self");
  // Per-option checked state for the current 86 It question. Everything starts
  // checked; the player's job is to take things away.
  const [kept, setKept] = useState([]);
  const [saved, setSaved] = useState("");
  const [search, setSearch] = useState("");
  // "all" | "tried" | "untried" — index-only, deliberately not persisted: it is a
  // way of looking at the list, not progress worth syncing between devices.
  const [triedFilter, setTriedFilter] = useState("all");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!firebaseEnabled);
  // The whitelist answer, stamped with the address it was an answer ABOUT.
  // Carrying the email means "have we checked?" and "checked for whom?" are the
  // same question, so a stale yes can't outlive the account that earned it:
  // sign out of a whitelisted address and into another and the answer stops
  // applying the moment `user` changes, without an effect racing to take it
  // back. null until the first check resolves.
  const [adCheck, setAdCheck] = useState(null);
  const [showAdAdmin, setShowAdAdmin] = useState(false);
  const [whitelist, setWhitelist] = useState([]);
  const [whitelistInput, setWhitelistInput] = useState("");
  const [whitelistMsg, setWhitelistMsg] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  const [backupBusy, setBackupBusy] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const [backupErr, setBackupErr] = useState("");
  // Blank restores everyone; an address or uid restores that one account, which
  // is the case that actually comes up — someone writes in having lost theirs.
  const [restoreWho, setRestoreWho] = useState("");
  const [restoreResult, setRestoreResult] = useState(null);
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
  // Web only: has an ad actually rendered on this page? Starts false and flips
  // once AdSense fills a unit — see areAdsServing() in src/ads.js.
  const [adsServing, setAdsServing] = useState(() => areAdsServing());
  // Android only: whether Google's UMP wants us to offer a way back into the
  // consent choice (it does in the EEA/UK once a choice has been made).
  const [privacyOptionsRequired, setPrivacyOptionsRequired] = useState(false);
  // Why the RevenueCat link failed, if it did. Rendered in the Pro card because
  // the Play build has no console a tester can reach: without this the only
  // symptom is a button that says "Connecting…" for ever.
  const [billingErr, setBillingErr] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  // Seeded from the Checkout return so the first paint already says what
  // happened. Gated on firebaseEnabled to match the effect that follows it up:
  // without a backend there is nothing to confirm the purchase against, so
  // promising one would be a message the app can't stand behind.
  const [purchaseMsg, setPurchaseMsg] = useState(
    !firebaseEnabled ? ""
      : CHECKOUT_RESULT === "success" ? "Thanks for your purchase! Finishing up…"
      : CHECKOUT_RESULT === "cancelled" ? "Checkout cancelled."
      : ""
  );
  // Email/password sign-in exists mainly so Play Console's App access reviewers
  // have credentials that work — OAuth accounts trip Google's own security
  // challenges from a reviewer's device. Kept collapsed behind a text link so
  // Google stays the obvious choice for everyone else.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [googleErr, setGoogleErr] = useState("");
  const [googleErrDetail, setGoogleErrDetail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  // Account deletion — required by Play for any app that offers account creation.
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // The Progress screen's own busy flag and result line, for the restore a user
  // runs on their own account. Separate from the admin panel's `backupBusy`:
  // both live on this screen now, and one running must not grey out the other.
  const [selfBusy, setSelfBusy] = useState(false);
  const [selfMsg, setSelfMsg] = useState("");
  const [selfErr, setSelfErr] = useState("");

  // The high-water mark's own health, for the readout on Backup & Reset.
  //
  // This screen promises the account "keeps your maximum progress", and until
  // now it made that promise with no way to see whether it was true. It was not:
  // the rules denying every write failed into console.error alone (saveHighWater,
  // and the seed read below), so a backup that had never once succeeded looked
  // identical to a healthy one for weeks.
  //
  // Health and age are kept apart on purpose. `hwErr` is the only thing that
  // means something is wrong; `hwSavedAt` is when the mark last MOVED, which on
  // a healthy account that hasn't learned anything new is legitimately weeks ago
  // — read as "last backed up" it would invent the false alarm this exists to
  // prevent. It is labelled "last incremented" rather than "last raised": the
  // mark is only ever raised in this codebase's sense, but to anyone who reads
  // code "raised" is what happens to an error. `hwPeak` is what the mark actually holds, which is the reading that
  // cannot go misleadingly stale: 0 mastered beside a live 25 is the alarm.
  const [hwErr, setHwErr] = useState("");
  const [hwSavedAt, setHwSavedAt] = useState(null);
  const [hwPeak, setHwPeak] = useState(null);
  // The uid whose cloud progress this device has actually read back and
  // reconciled with. Until it matches the signed-in user, `st` is only what this
  // device happened to be holding, and nothing may be written up from it.
  const [syncedUid, setSyncedUid] = useState(null);
  // Set only by signOutUser(), and cleared as soon as it is acted on. Firebase
  // reports a null user for more than a deliberate sign-out, and the difference
  // decides whether this device's progress is cleared — see the auth effect.
  const signOutIntent = useRef(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  // The whitelist question this render is asking about, and the two readings
  // derived from the stamped answer above. Derived rather than stored so the
  // pair can never disagree: `adCheckDone` is false for exactly as long as the
  // answer on hand is about somebody else, which is the window in which the
  // previous account's yes would otherwise still be reading as this one's.
  // Without a backend nobody is whitelisted and there is nothing to wait for;
  // with one, an address that hasn't finished signing in has nothing to check.
  const adEmail = firebaseEnabled && authReady ? (user?.email || null) : null;
  const adWhitelisted = Boolean(adCheck && adCheck.email === adEmail && adCheck.whitelisted);
  const adCheckDone = !firebaseEnabled || (authReady && (!adEmail || adCheck?.email === adEmail));

  // One purchase — "Cocktail Flashcards Pro" — carries both halves of the
  // product: no ads, and the whole library instead of the free top 50. Two names
  // for the one flag so each call site reads as the half it is about. The ad
  // whitelist grants Pro outright: it is handed out by an admin, not bought.
  const isPro = adWhitelisted || adsRemovedCloud || adsRemovedNative;
  const adFree = isPro;
  // The cloud-sync effect below mounts once, so the `isPro` its snapshot handler
  // closed over is frozen at whatever it was then — false, on a cold start. A ref
  // keeps the live value reachable in there, so a merge can never narrow the pool
  // of someone who has already been confirmed as Pro.
  const proRef = useRef(false);
  // This account's high-water mark: everything it has ever had, held here so a
  // save does not have to read it back first. Seeded from highWater/{uid} at
  // sign-in, raised on every save, never lowered — see saveHighWater().
  const highWaterRef = useRef(null);
  useEffect(() => { proRef.current = isPro; }, [isPro]);

  // Is this visitor actually being served web ads right now? It no longer
  // decides whether Pro is offered — Pro also unlocks the library, so there is
  // always something to sell — but it does decide whether the pitch may promise
  // to remove ads, which would otherwise advertise a change this visitor would
  // never see. Three things have to hold:
  //
  //   1. this is the web build (the Play build sells the same thing natively);
  //   2. a publisher id is configured — VITE_ADSENSE_CLIENT set to an empty
  //      string switches web ads off outright and the tag never loads;
  //   3. an ad has actually rendered. Condition 2 is true on every normal build,
  //      so it cannot carry this alone: the tag loads perfectly well against an
  //      account AdSense hasn't approved, behind an ad blocker, or on a page
  //      nothing filled, and renders nothing in all three cases. adsServing is
  //      the page's own answer rather than a guess from config.
  //
  // ...and the user must not already be ad-free, since there'd be nothing left
  // for the ad half of the pitch to promise.
  //
  // Consent is deliberately not a term here. The AdSense tag loads before the
  // user decides because it carries the consent prompt — but an undecided
  // European visitor is shown no ad, so condition 3 already covers them without
  // needing to reason about consent state separately.
  //
  // The split matters: the ad SLOTS render on eligibility, and adsServing only
  // becomes true because one of them filled. Gating the slots on adsServing too
  // would be circular — no slot, so no fill, so no slot.
  const webAdsEligible = FEATURES.ads && isAdNetworkConfigured && !adFree;
  const webAdsServed = webAdsEligible && adsServing;

  const isAdmin = firebaseEnabled && Boolean(user?.email) && ADMIN_EMAILS.includes(user.email.toLowerCase());

  // Held shut until RevenueCat's app-user id is confirmed to be this uid — a
  // purchase started before that lands on the wrong id and can never be
  // attributed to the account. Computed here rather than inside the button so
  // the diagnostics below can explain the wait.
  const awaitingIdentity = firebaseEnabled && Boolean(user) && linkedUid !== user.uid;

  // Master Mode counts only when it is both switched on and paid for.
  const masterOn = Boolean(st.masterMode) && isPro;
  const pool = poolFor(st, isPro);
  const poolNames = new Set(pool.map(c => c.name));
  // Counted within the pool: a deck that once held the whole library would
  // otherwise report more cocktails learned than the free tier even has, and
  // push the progress bar past 100%.
  const learned = (st.learned || []).filter(n => poolNames.has(n)).length;
  // The deck as it is studied, which is `st.active` narrowed to the pool. Stored
  // state can hold cards the pool no longer covers — progress saved while the
  // full library was on, and every deck built back when it was free — and
  // refillDeck only clears those out on the next write. Narrowing at the point of
  // use means the free tier never studies a paid cocktail in the meantime, and
  // nothing is deleted to achieve it.
  const deck = st.active.filter(n => poolNames.has(n));
  const total = pool.length;
  const deckSize = st.deckSize || DECK_SIZE;

  // localStorage is the external system being synchronised here; the "✓" is only
  // a flash confirming it happened. Both halves of that flash are scheduled
  // rather than set inline, so the effect body never re-renders synchronously
  // with the write. Clearing them on the way out also fixes a flicker: a save
  // arriving mid-flash used to leave the previous timer running, which blanked
  // the tick the newer save had just lit.
  useEffect(() => {
    saveLocal(st);
    const show = setTimeout(() => setSaved("✓"), 0);
    const hide = setTimeout(() => setSaved(""), 1200);
    return () => { clearTimeout(show); clearTimeout(hide); };
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
      // Whoever signs in next has their own mark; one account's must never be
      // written to another's document — nor have another's health reported
      // under it. A stale permission-denied from the previous account, shown
      // beside this one's progress, is its own diagnostic wild goose chase.
      highWaterRef.current = null;
      setHwErr(""); setHwSavedAt(null); setHwPeak(null);
      // A new subscription has to re-do the handshake before this device may
      // write again, whichever user it turns out to be.
      setSyncedUid(null);
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
          const accountPro = Boolean(data?.adsRemoved);
          setAdsRemovedCloud(accountPro);
          // A snapshot served from the local cache is not an answer about what
          // this account holds. Firestore runs on the default memory cache
          // (src/firebase.js), and the service worker lets the app boot with no
          // network at all, so a cold offline start raises a snapshot reporting
          // a document the client has simply never seen as absent. Read as "this
          // account has no progress", that sent the handshake below down its
          // `initState` branch and wrote a starter deck over a real one. Nothing
          // is resolved, and firstSnapshot is not spent, until the server speaks.
          if (snap.metadata.fromCache) return;
          // How wide the merged pool may be. Read from this very snapshot rather
          // than from state that hasn't re-rendered yet, and unioned with what we
          // already know so a native-only purchase isn't overlooked.
          const pro = accountPro || proRef.current;

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
                // Drinks marked tried before signing in are progress too, and
                // without this they are discarded by the branch below.
                (prev.tried && prev.tried.length > 0) ||
                Object.values(prev.scores || {}).some(v => v > 0);
              const anonymousWithProgress = !prev.uid && hasLocalProgress;
              const resolved = (sameUser || anonymousWithProgress)
                ? mergeStates(prev, cloud, pro)
                : (cloud ? refillDeck(cloud, poolFor(cloud, pro)) : initState(false));
              const stamped = { ...resolved, uid: u.uid };
              setDoc(doc(db, "users", u.uid), { progress: stamped, updatedAt: Date.now() }, { merge: true })
                .catch(e => console.error("Cloud sync failed", e));
              return stamped;
            });
            // Seed the high-water mark before the first save can raise it. Read
            // separately from users/{uid}: it is a different document, and on a
            // device that has never saved it is the only place this account's
            // best state exists. A failure here is not fatal — the mark starts
            // from what this device knows and grows from there, and the rules
            // reject any write that would lower it. Nor is arriving after a save
            // has already raised it: merging into whatever the ref holds, rather
            // than assigning over it, is what makes the two orders agree.
            getDoc(doc(db, "highWater", u.uid))
              .then(hw => {
                highWaterRef.current = mergeProgress(
                  highWaterRef.current, hw.exists() ? hw.data()?.progress : null, u.uid);
                // This read is the better health signal of the two, and the
                // reason the readout is trustworthy on arrival: it runs on every
                // sign-in, where a write only happens once something has actually
                // been learned. Through the broken weeks this failed every single
                // time while writes were sporadic.
                setHwErr("");
                setHwSavedAt(hw.exists() ? hw.data()?.updatedAt || null : null);
                setHwPeak(peakCounts(highWaterRef.current));
              })
              .catch(e => {
                console.error("Could not read the high-water mark", e);
                setHwErr(e?.code || "unavailable");
              });
            // The account's own progress is now folded in, so the autosave effect
            // below is free to write. Before this point it would have been
            // writing whatever this device happened to hold.
            setSyncedUid(u.uid);
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
            const merged = { ...mergeStates(prev, cloud, pro), uid: u.uid };
            if (progressEqual(prev, merged)) return prev;
            // The remote update can drop the card we're sitting on, so keep the
            // study index inside the new deck.
            setDi(d => Math.min(d, Math.max(0, merged.active.length - 1)));
            return merged;
          });
        }, e => console.error("Cloud sync failed", e));
      } else {
        setAdsRemovedCloud(false);
        // Clear progress on sign-out so the next user starts fresh — but only on
        // a sign-out the user actually asked for. Firebase reports a null user
        // for a good deal more than that: a refresh token the backend rejects, an
        // account disabled elsewhere, auth storage the WebView has evicted (it
        // lives in IndexedDB, while progress lives in localStorage, and the two
        // are evicted independently). Every one of those used to wipe the device
        // with nobody having touched anything. Leaving the progress alone is safe
        // — it still carries the uid it was earned under, so the handshake above
        // will not fold it into a different account — and when auth comes back,
        // that same uid makes it a same-user merge with nothing lost.
        if (signOutIntent.current) {
          signOutIntent.current = false;
          setSt(prev => (prev.uid ? initState(false) : prev));
          setDi(0); setRevealed(false);
        }
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
    sync.then(({ ok, active, error }) => {
      setLinkedUid(ok && user ? user.uid : null);
      setAdsRemovedNative(Boolean(active));
      setBillingErr(ok ? null : (error || null));
    }).catch(e => {
      // A rejection here would otherwise leave the button on "Connecting…" with
      // nothing said, which is the exact failure this panel exists to end.
      setBillingErr({ step: "link", message: e?.message || String(e), code: e?.code ? String(e.code) : null });
    });
  }, [authReady, user]);

  // After returning from Stripe Checkout, re-check the ads-removed flag a few
  // times since the webhook that sets it runs asynchronously and may lag
  // slightly behind the redirect back to the app.
  //
  // What is left here is the part that genuinely belongs in an effect: the URL
  // cleanup and the polling. Both of the messages the parameter can produce on
  // arrival are already on screen as the initial purchaseMsg above. Note the
  // firebaseEnabled gate comes first, so a build without a backend leaves the
  // parameter on the URL exactly as it always has.
  useEffect(() => {
    if (!firebaseEnabled || !CHECKOUT_RESULT) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (CHECKOUT_RESULT === "success") {
      let attempts = 0;
      const check = async () => {
        attempts += 1;
        const u = auth.currentUser;
        if (u) {
          try {
            const snap = await getDoc(doc(db, "users", u.uid));
            if (snap.exists() && snap.data().adsRemoved) {
              setAdsRemovedCloud(true);
              setPurchaseMsg("You're Pro. Thanks for your support!");
              return;
            }
          } catch (e) { console.error("Failed to confirm purchase", e); }
        }
        if (attempts < 6) setTimeout(check, 1500);
        else setPurchaseMsg("Purchase received — it may take a minute to apply.");
      };
      check();
    }
  }, []);

  // Raise this account's high-water mark alongside the ordinary save.
  //
  // users/{uid} holds the CURRENT state and so follows it down: a reset, or a
  // bug of the kind that emptied accounts, writes the emptied state straight
  // over the full one. highWater/{uid} is the same progress under a different
  // rule — it only ever grows — so the best an account has ever reached
  // survives whatever happens to the live document. Admin restore reads this
  // document directly, so the peak is already backed up the moment it is
  // reached — there is no export step and nothing to schedule.
  //
  // Progress only. This document is client-written and a restore pushes it back
  // into users/{uid}, so an entitlement riding along here would be one any user
  // could grant themselves. firestore.rules refuses any other field.
  function saveHighWater(uid, progress) {
    const raised = mergeProgress(highWaterRef.current, progress, uid);
    if (!raised) return;
    if (!growsFrom(highWaterRef.current, raised)) {
      // Unreachable unless the merge itself is wrong: the rules would reject
      // this write anyway, so fail loudly here rather than silently there.
      // A different fault from a denied write — a bug, not a permission — but
      // the same invisibility, and the same consequence for the person relying
      // on the mark, so it reaches the readout by the same route.
      console.error("High-water merge would lose progress; not writing", uid);
      setHwErr("merge-guard");
      return;
    }
    // Nothing new to record: skip the write rather than spend one saying so.
    // Studying re-reads and re-saves constantly, and the mark only moves when
    // something is actually learned, tried or scored higher.
    if (sameProgress(highWaterRef.current, raised)) return;
    highWaterRef.current = raised;
    const at = Date.now();
    setDoc(doc(db, "highWater", uid), { progress: raised, updatedAt: at }, { merge: true })
      .then(() => { setHwErr(""); setHwSavedAt(at); setHwPeak(peakCounts(raised)); })
      .catch(e => {
        console.error("High-water save failed", e);
        setHwErr(e?.code || "unavailable");
      });
  }

  // Push progress to the cloud whenever it changes and a user is signed in.
  useEffect(() => {
    if (!firebaseEnabled || !user) return;
    // Not until the handshake above has read this account back and reconciled it.
    // `user` is set the moment auth resolves, but the first snapshot can be
    // hundreds of milliseconds behind it — or never arrive, on a device that is
    // offline — and in that window `st` is just this device's local copy. On a
    // fresh install that copy is a starter deck, and writing it up (merge:true
    // replaces the whole `progress` field) overwrote accounts that had years in
    // them. Waiting costs nothing: the merged state is written by the handshake.
    if (syncedUid !== user.uid) return;
    const t = setTimeout(() => {
      // merge:true so autosaving progress never clobbers server-owned fields
      // like `adsRemoved` (set by the Stripe webhook via the Admin SDK).
      setDoc(doc(db, "users", user.uid), { progress: st, updatedAt: Date.now() }, { merge: true }).catch(e => console.error("Cloud save failed", e));
      saveHighWater(user.uid, st);
    }, 800);
    return () => clearTimeout(t);
  }, [st, user, syncedUid]);

  // Check whether the signed-in user's email is on the ad whitelist. Only the
  // lookup lives here — the signed-out case needs no effect at all, because
  // "nobody to ask about" is already what the derivation above reads as done and
  // not whitelisted. A failed check is recorded as a no rather than left blank,
  // so an unreachable whitelist shows ads instead of hanging the ad slots.
  useEffect(() => {
    if (!adEmail) return;
    let cancelled = false;
    isEmailAdWhitelisted(adEmail)
      .then(w => { if (!cancelled) setAdCheck({ email: adEmail, whitelisted: w }); })
      .catch(e => { console.error("Ad whitelist check failed", e); if (!cancelled) setAdCheck({ email: adEmail, whitelisted: false }); });
    return () => { cancelled = true; };
  }, [adEmail]);

  // Load the AdSense tag only once we know the current user isn't ad-free. Never
  // in the Play Store build, which serves AdMob instead (see monetization.js) —
  // FEATURES.ads is false there, and AdSense-in-app breaks AdSense program policy.
  //
  // Deliberately NOT gated on consent: Google's GDPR message is delivered by this
  // very tag, so blocking it would block the consent prompt itself. Ads are
  // withheld until consent by Google's CMP, and the Consent Mode defaults in
  // index.html keep storage denied across the EEA/UK/CH until the user decides.
  useEffect(() => {
    if (!FEATURES.ads || !adCheckDone || adFree) return;
    loadAds();
  }, [adCheckDone, adFree]);

  // Show the privacy-settings link only where GDPR applies (web build).
  useEffect(() => {
    if (!FEATURES.ads) return;
    onGdprApplicable(applies => setGdprApplies(applies));
  }, []);

  // Let the Pro card promise no ads only once an ad is genuinely on screen. The
  // subscription is set up unconditionally rather than inside the load effect
  // above, so it is already listening whichever order the two resolve in.
  useEffect(() => {
    if (!FEATURES.ads) return;
    return onAdsServing(setAdsServing);
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

  // Classifying a native sign-in failure.
  //
  // The plugin hands Android's own GetCredentialException text straight through
  // as the message, and derives no error code for it at all — createErrorCode
  // only maps FirebaseAuthException, so e.code is null on this path. The message
  // is the only signal there is.
  //
  // Match on phrasing, not on status code alone. Play services reuses status 16
  // (CommonStatusCodes.CANCELED) for several unrelated outcomes — a dismissed
  // picker, a missing credential, and an unregistered signing certificate — so
  // keying off ":16:" reported whichever of those was checked first rather than
  // what actually happened. isSignInCancellation lives in native-auth.js
  // alongside the retry that depends on it, so the two can't drift apart.
  //
  // 10 is DEVELOPER_ERROR: the running app's package name and signing
  // certificate match no OAuth client registered for the project.
  //
  // "account reauth failed" is that same fault seen through Credential Manager,
  // which reports it under status 16 and names nothing useful. It reads like a
  // stale account on the device, and following that reading cost most of a day
  // — the account is fine, and the wording is why the search results for it all
  // recommend re-adding it and checking the clock. The tell was that it
  // reproduced identically for a Workspace account and a personal one on the
  // same phone. The legacy path, which reports Play services' status codes
  // plainly, answered 10 for the very same attempt. One cause, two wordings.
  function isSigningCertMismatch(e) {
    const t = signInFailureText(e);
    return /developer console is not set up correctly|account reauth failed|:\s*10:/i.test(t);
  }
  function isNoAccountOnDevice(e) {
    const t = signInFailureText(e);
    return /nocredential|no credentials|cannot find a matching credential/i.test(t);
  }

  // Google sign-in takes one of two routes.
  //
  // In the store app the popup and redirect below are both dead ends — see
  // src/native-auth.js — so hand off to Android's account picker. Everywhere
  // else, and on store installs too old to carry the plugin, keep the popup
  // with the redirect behind it.
  function signIn(provider = googleProvider) {
    if (!firebaseEnabled) { alert("Cloud sync isn't configured for this app yet."); return; }
    setGoogleErr("");
    setGoogleErrDetail("");
    if (provider === googleProvider && nativeGoogleSignInAvailable()) {
      signInWithGoogleNative().catch(e => {
        console.error("Native Google sign-in failed:", e.code, e.message, e);
        // Dismissing the picker is a decision, not a fault — don't nag about it.
        if (isSignInCancellation(e)) return;
        setGoogleErr(
          isNoAccountOnDevice(e)
            ? "No Google account on this device. Add one in Android settings, then try again."
            : isSigningCertMismatch(e)
            ? "This build isn't registered for Google sign-in. Its signing certificate needs adding to the Firebase project."
            : "Google sign-in didn't complete. Try again."
        );
        // The raw text as well. A Play-installed app can't be reached with
        // logcat or a WebView inspector, so without this a tester's only report
        // is "it didn't work" — which is what sent the last round of debugging
        // down the wrong path.
        setGoogleErrDetail(signInFailureText(e));
      });
      return;
    }
    signInWithPopup(auth, provider).catch(e => {
      console.error("Popup sign-in failed:", e.code, e.message, e);
      // Popups can be closed prematurely by browser privacy settings or extensions — fall back to a full-page redirect.
      signInWithRedirect(auth, provider).catch(e2 => console.error("Redirect sign-in failed:", e2.code, e2.message, e2));
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
    setGoogleErr("");
    setGoogleErrDetail("");
    // Fire-and-forget alongside the JS sign-out: this only drops the native
    // account selection; the JS sign-out below is what ends the session.
    signOutGoogleNative();
    // Tells the auth effect that the null user about to arrive is this, and not
    // a session Firebase dropped on its own.
    signOutIntent.current = true;
    signOut(auth).catch(e => { signOutIntent.current = false; console.error("Sign-out failed", e); });
  }

  // Restore one account, or every account, to its best known state. No file is
  // involved: the server reads highWater/{uid} and purchaseLedger/{uid} — both
  // already durable, already current, already in Firestore — and merges them
  // into users/{uid} directly. See netlify/functions/admin-restore.mjs.
  //
  // dryRun reads and compares without writing, so an operator can see what
  // would change before it does. The restore itself can only ever add — see
  // netlify/functions/_backup.mjs — so the confirm is a courtesy, not a guard.
  async function runRestore(dryRun) {
    const who = restoreWho.trim();
    if (!dryRun && !confirm(
      who
        ? `Restore ${who} to their best known progress?\n\nProgress is merged, never replaced: scores keep whichever value is higher and nothing already there is removed. A purchase can only be restored, never revoked.`
        : `Restore every account to its best known progress?\n\nProgress is merged, never replaced: scores keep whichever value is higher and nothing already there is removed. A purchase can only be restored, never revoked.`
    )) return;

    setBackupErr(""); setRestoreResult(null); setBackupBusy(dryRun ? "preview" : "restore");
    try {
      const idToken = await user.getIdToken();
      const isUid = who && !who.includes("@");
      const result = await restoreProgress(idToken, {
        uid: isUid ? who : undefined,
        email: isUid ? undefined : (who || undefined),
        dryRun,
        onProgress: (done) => setBackupMsg(`${dryRun ? "Checked" : "Restored"} ${done} so far…`),
      });
      setRestoreResult(result);
      setBackupMsg("");
    } catch (e) {
      console.error("Restore failed", e);
      setBackupMsg(""); setBackupErr(e.message || "Restore failed.");
    } finally { setBackupBusy(""); }
  }

  // Restore this account's OWN progress, to the maximum it has ever reached.
  //
  // No server, and no admin: highWater/{uid} is this user's own document and
  // firestore.rules already lets its owner read it (`allow get` on a uid match),
  // so the whole restore is a read and a merge on the client. The admin endpoint
  // below stays for the case this cannot cover — restoring somebody else, or
  // restoring a purchase, which lives in a ledger no client may read.
  //
  // Folded in with mergeStates(), the same union-and-max the sign-in handshake
  // uses to reconcile a device with its account. That is what makes this safe to
  // press at any time, including by someone who has not lost anything: it only
  // ever ADDS. A score already higher here stays, a cocktail learned since the
  // mark was last raised is kept, and pressing it twice does nothing the second
  // time. The autosave effect writes the result up as it would any other change.
  async function restoreOwnProgress() {
    setSelfErr(""); setSelfMsg(""); setSelfBusy(true);
    try {
      const snap = await getDoc(doc(db, "highWater", user.uid));
      // Unioned with the mark already in memory rather than taken raw: this
      // device may have raised it since sign-in, and a restore must not be the
      // one thing that walks progress backwards.
      const peak = mergeProgress(highWaterRef.current, snap.exists() ? snap.data()?.progress : null, user.uid);
      if (!peak) {
        setSelfMsg("There is no saved progress for this account yet — nothing to restore.");
        return;
      }
      highWaterRef.current = peak;
      setHwPeak(peakCounts(peak));

      // Counted against this render's state, for the message only; the write
      // below re-merges from `prev` so nothing that lands in between is lost.
      const merged = mergeStates(st, peak, proRef.current);
      const learnedBack = (merged.learned?.length || 0) - (st.learned?.length || 0);
      const triedBack = (merged.tried?.length || 0) - (st.tried?.length || 0);
      const scoresBack = Object.keys(merged.scores || {})
        .filter((n) => (Number(merged.scores[n]) || 0) > (Number(st.scores?.[n]) || 0)).length;

      setSt(prev => ({ ...mergeStates(prev, peak, proRef.current), uid: user.uid }));
      setDi(0); setRevealed(false);

      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      setSelfMsg(learnedBack || triedBack || scoresBack
        ? `Restored to your maximum progress \u2014 ${plural(learnedBack, "cocktail")} mastered, ${plural(triedBack, "tried mark")} and ${plural(scoresBack, "score")} brought back.`
        : "Your progress is already at its maximum — there was nothing to bring back.");
    } catch (e) {
      console.error("Restore failed", e);
      // Name the fault instead of guessing at it. This read fails three ways
      // that are not the same problem: `unavailable` is the connection,
      // `unauthenticated` is a session whose token expired underneath a UI that
      // still looks signed in, and `permission-denied` means the rules the
      // project is running do not grant an owner `get` on highWater/{uid} —
      // firestore.rules is deployed by hand (see its header), so it can lag the
      // code that depends on it. Only the first is helped by checking your
      // signal, and sending the other two there points at the one part that is
      // working. Same reasoning as startCheckout() below: surface the specific
      // reason so the failure is diagnosable rather than always showing one
      // message. The code rides along in the text so a screenshot is enough to
      // tell the three apart, which is what was missing the first time this
      // failed in the wild.
      const denied = e?.code === "permission-denied" || e?.code === "unauthenticated";
      setSelfErr(denied
        ? `Your account wasn't allowed to read its saved progress (${e.code}). Try signing out and back in — if that doesn't help it's a problem on our end, not yours, and nothing you have done here has lost anything.`
        : `Could not reach your saved progress${e?.code ? ` (${e.code})` : ""}. Check your connection and try again.`);
    } finally { setSelfBusy(false); }
  }

  // Deletes the cloud account and its data, then clears this device. The server
  // does the work — firestore.rules forbids clients deleting users/{uid}, and
  // the client SDK's deleteUser() rejects sessions older than a few minutes.
  async function deleteAccount() {
    if (!user || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteErr("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/.netlify/functions/delete-account", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Deletion failed");

      // Local progress is a separate copy that no server call can reach, so
      // "delete my data" has to clear it here or it would survive on the device.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ }
      setSt(initState(false));
      setDeleteConfirm(false);
      // The account is already gone server-side; this just drops the local
      // session so the UI returns to signed-out.
      await signOut(auth).catch(e => console.error("Sign-out after deletion failed", e));
    } catch (e) {
      console.error("Account deletion failed:", e);
      setDeleteErr(e.message || "Deletion failed. Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function startCheckout() {
    if (!user) { alert("Sign in first to get Pro."); return; }
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
      // assign() rather than `location.href = …`: identical navigation, but it
      // reads as the call it is, which keeps the React lint from seeing a write
      // to a value it tracks now that unlockPro() also reaches this function.
      window.location.assign(data.url);
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

  // One entry point for "I want Pro", wherever it was asked from: the library
  // switch, a locked cocktail in the Index, the quiz length picker. Which flow
  // that is belongs to the build — Play Billing inside the Android shell, Stripe
  // Checkout on the web — and neither is a dead end, because both surface their
  // own failures through purchaseMsg.
  function unlockPro() {
    if (isPro) return;
    if (billingReady) { buyRemoveAdsNative(); return; }
    if (FEATURES.stripePurchase && firebaseEnabled) { startCheckout(); return; }
    // No purchase path in this build. Say so on the menu, where the message
    // renders, rather than swallowing the tap.
    setPurchaseMsg("Purchases aren't available in this build.");
    setMode("menu");
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

  const col = s => s >= MASTERY_SCORE ? C.success : s >= 4 ? C.accent : s >= 2 ? C.masteryMid : C.textFaint;

  function upd(fn) { setSt(p => typeof fn === "function" ? fn(p) : fn); }

  // <html data-theme> drives index.css: the two font stacks, the page chrome and
  // the wash over the bar photograph. The meta tag moves with it so the Android
  // status bar and the browser's own chrome do not stay the other scheme's
  // colour — the one piece of the theme that lives outside both stylesheets.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEMES[theme].ink);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }, [theme]);

  // The tried marker reads the same on a card and on an index row, so both use
  // this. Unchecked it asks the question, checked it states the answer.
  function triedChip(name, big) {
    const on = (st.tried || []).includes(name);
    return (
      <button
        onClick={()=>toggleTried(name)}
        aria-pressed={on}
        title={on ? "Marked as tried — click to unmark" : "Mark as tried"}
        style={{whiteSpace:"nowrap",borderRadius:8,cursor:"pointer",fontWeight:700,
          padding: big ? "0.35rem 0.7rem" : "0.3rem 0.6rem",
          fontSize: big ? "0.8rem" : "0.72rem",
          border: on ? "none" : `1px solid ${C.accentAltEdge}`,
          background: on ? C.accentAlt : "transparent",
          color: on ? C.textOnFill : C.accentAltLite}}>
        {on ? "☑ Tried" : "☐ Tried?"}
      </button>
    );
  }

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
    const cur = Math.min(di, deck.length - 1);
    if (cur < 0) return;
    // Graded by name, not by position: `deck` and `p.active` only line up once
    // the out-of-pool cards have been cleared out of the stored deck.
    const ci = deck[cur];
    upd(p => {
      const ns = Math.max(0, (p.scores[ci] || 0) + (correct ? 1 : -1));
      const scores = { ...p.scores, [ci]: ns };
      let active = [...p.active], learned = [...(p.learned||[])];
      const mastered = ns >= MASTERY_SCORE;
      if (mastered) { learned.push(ci); active = active.filter(n => n !== ci); }
      const u = refillDeck({ ...p, scores, active, learned }, pool);
      const next = mastered ? Math.min(cur, u.active.length-1) : u.active.length > 0 ? (cur+1) % u.active.length : 0;
      setDi(Math.max(0, next)); setRevealed(false);
      return u;
    });
  }

  function next() { setDi(i => (i+1) % deck.length); setRevealed(false); }
  function prev() { setDi(i => (i-1+deck.length) % deck.length); setRevealed(false); }
  // Build a fresh, fully-shuffled quiz order every time — quizzing always draws
  // from the whole pool in random sequence (Fisher–Yates), never the fixed pool
  // order. Shuffling before the slice is what makes a short quiz a random sample
  // of the pool rather than its first n cocktails. n = null takes everything.
  function startQuiz(n) {
    const q = shuffled(pool);
    setQuizLen(n ?? null);
    setQuizPool(n ? q.slice(0, n) : q);
    setQa([]); setQi(0); setQr(false); setMode("quiz");
  }
  function qGrade(k) {
    const ans = [...qa, k];
    setQa(ans);
    if (qi+1 >= quizPool.length) setMode("results");
    else { setQi(i=>i+1); setQr(false); }
  }

  // 86 It. Same shuffle-then-slice as startQuiz, so a short round is a random
  // sample of the pool rather than its first n drinks, but each question also
  // carries the options it will offer. They are generated up front, once: built
  // during render they would redraw their impostors on every keystroke.
  function start86Quiz(n) {
    // `pool` already honours master mode; eligibility drops the one drink that
    // cannot make a question.
    const eligible = shuffled(pool.filter(eightySixEligible));
    const chosen = (n ? eligible.slice(0, n) : eligible)
      .map(c => buildEightySixQuestion(c, LEXICON));
    setQuizKind("86");
    setQuizLen(n ?? null);
    setQuizPool(chosen);
    setKept(chosen[0] ? chosen[0].options.map(() => true) : []);
    setQa([]); setQi(0); setQr(false); setMode("quiz");
  }

  // Right only when every real ingredient is still checked AND every impostor
  // is gone. Leaving an impostor in is the same mistake as taking a real
  // ingredient out, so both cost the question.
  function check86() {
    const q = quizPool[qi];
    setQa(a => [...a, q.options.every((o, i) => kept[i] === o.real)]);
    setQr(true);
  }

  function next86() {
    if (qi + 1 >= quizPool.length) { setMode("results"); return; }
    setKept(quizPool[qi + 1].options.map(() => true));
    setQi(i => i + 1);
    setQr(false);
  }

  function toggleKept(i) {
    setKept(k => k.map((v, j) => j === i ? !v : v));
  }

  // Start whichever quiz the picker was opened for.
  function startPicked(n) { if (quizKind === "86") start86Quiz(n); else startQuiz(n); }

  // Switch the whole library into study and quizzes, or back to the free top 50.
  // The library is what Pro sells, so switching it on without Pro opens the
  // paywall instead of widening the pool.
  function toggleMaster() {
    if (!isPro) { unlockPro(); return; }
    upd(p => {
      const m = !p.masterMode, np = poolFor({ masterMode: m }, true);
      const scores = {...p.scores};
      np.forEach(c => { if (scores[c.name] === undefined) scores[c.name] = 0; });
      // `learned` is deliberately not filtered down to the pool: mastering a
      // cocktail is progress the user earned, and switching the library off is a
      // change of scope, not a reset. refillDeck takes the out-of-pool cards out
      // of the deck itself, which is all that has to happen here.
      return refillDeck({...p, scores, masterMode:m}, np);
    });
  }
  // Clearing drops every score, every mastered cocktail and every tried mark,
  // and the autosave effect then writes that emptied state over the copy held
  // under the account. "Reset all progress?" was far too easy to wave through,
  // so the confirm names each thing that goes and counts it.
  //
  // What it no longer claims is that the loss is permanent. For a signed-in
  // account it is not: highWater/{uid} keeps the maximum progress ever reached
  // and only ever grows, so clearing cannot lower it and Restore Progress puts
  // it straight back. Signed out there is no such copy, and the warning says so
  // — the same button really is irreversible in that case, and a confirm that
  // overstated the risk for one user would understate it for the other.
  function reset() {
    const mastered = st.learned?.length || 0;
    const triedCount = st.tried?.length || 0;
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const recoverable = Boolean(firebaseEnabled && user);
    const warning = [
      recoverable
        ? "\u26a0\ufe0f  CLEAR ALL PROGRESS  \u26a0\ufe0f"
        : "\u26a0\ufe0f  WARNING \u2014 THIS CANNOT BE UNDONE  \u26a0\ufe0f",
      "",
      "This erases ALL of your progress: on this device, and the copy saved to your account.",
      "",
      `  \u2022 ${plural(mastered, "cocktail")} mastered`,
      `  \u2022 ${plural(triedCount, "drink")} marked as tried`,
      "  \u2022 every quiz score you have earned",
      "  \u2022 your current study deck",
      "",
      recoverable
        ? "Your account keeps your maximum progress \u2014 the best you have ever reached. Restore Progress will bring it back."
        : "You are not signed in, so there is no saved copy to restore from. None of it can be recovered.",
      "",
      "Clear your progress now?",
    ].join("\n");
    if (!confirm(warning)) return;
    setSt(initState(masterOn)); setDi(0); setRevealed(false);
    setSelfErr(""); setSelfMsg(recoverable
      ? "Progress cleared. Restore Progress will bring back your maximum progress."
      : "Progress cleared.");
  }
  // Add or remove a cocktail from the study deck (st.active) by name. Adding a
  // cocktail also gives it a starting score and pulls it out of `learned` so it
  // reappears in study. The deck keeps its chosen size either way: an added card
  // goes to the FRONT so the size cap trims the deck's last card rather than the
  // one just added; a removed card's slot is refilled from the pool.
  //
  // Only cocktails in the current pool can go into a deck — the Index lists all
  // of them, but the ones past the free top 50 are what Pro sells. Without Pro
  // that tap opens the paywall; with it, the tap says "I want this cocktail", so
  // the full library comes on and the cocktail lands in the deck.
  function toggleStudy(name) {
    const needsLibrary = !poolNames.has(name);
    if (needsLibrary && !isPro) { unlockPro(); return; }
    upd(p => {
      const masterMode = p.masterMode || needsLibrary;
      const np = poolFor({ masterMode }, isPro);
      if (p.active.includes(name)) return refillDeck({ ...p, masterMode, active: p.active.filter(n => n !== name) }, np);
      const scores = { ...p.scores };
      if (scores[name] === undefined) scores[name] = 0;
      const learned = (p.learned || []).filter(n => n !== name);
      return refillDeck({ ...p, masterMode, scores, learned, active: [name, ...p.active] }, np);
    });
  }
  // Marking a drink tried is unrelated to studying it: it does not touch the
  // deck, the scores or the learned list, and a drink can be tried without ever
  // having been studied.
  function toggleTried(name) {
    upd(p => {
      const tried = new Set(p.tried || []);
      if (tried.has(name)) tried.delete(name); else tried.add(name);
      return { ...p, tried: Array.from(tried) };
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
    upd(p => refillDeck({ ...p, deckSize: n }, poolFor(p, isPro)));
    setDi(0); setRevealed(false);
  }

  // The whole scheme, resolved once per render. Every C.* below is a lookup into
  // whichever object is on, so no screen has to know which that is.
  const C = THEMES[theme] || THEMES[DEFAULT_THEME];

  const wrap = { maxWidth:480, width:"100%" };
  const page = { minHeight:"100dvh", background:C.surfacePage, backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", color:C.textStrong, display:"flex", flexDirection:"column", alignItems:"center", padding:"1.5rem 1rem" };
  // `...C.ui.btn` is where a scheme sets its own lettering — Future puts button
  // labels in tracked caps. The glow is keyed off the button's own fill so each
  // one lights in its own colour rather than a single generic halo.
  const btn = (bg, x={}) => ({
    padding:"1rem", borderRadius:12, background:bg, color:C.textOnFill, fontWeight:700,
    fontSize:"1rem", border:"none", cursor:"pointer",
    boxShadow: C.ui.glow ? `0 0 18px -5px ${bg}` : "none",
    ...C.ui.btn, ...x,
  });
  const FRAME_BG = C.surfaceCard;
  const frame = (x={}) => ({ background:FRAME_BG, backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", ...x });
  // The admin form stacks in a narrow footer column, so the fields take the full
  // width rather than the flex-basis pairing they used inside the account card.
  const stackedField = { width:"100%", boxSizing:"border-box", background:C.well, border:`1px solid ${C.border}`, borderRadius:8, padding:"0.4rem 0.6rem", fontSize:"0.8rem", color:C.textBody };

  // The Backup & Reset screen. Restoring and clearing are the same subject from
  // opposite ends, and they were in different places — clearing at the foot of
  // the menu, restoring in an admin panel no ordinary user could see. They are
  // one screen now, one tap off the menu, and the restore is the user's own.
  //
  // Named for both halves rather than "Progress": the menu already SHOWS
  // progress a few rows up, in the tiles and the bar, so a button repeating the
  // word would read as another readout instead of somewhere to go and act.
  //
  // Green above red, and the green one first: the recoverable action is the one
  // most people arriving here actually want, and reading order should not put
  // the destructive one under the thumb of somebody scanning for help.
  //
  // The two fills are the study screen's own — jadeDeep from "Got It", oxblood
  // from "Missed It" — so yes and no read the same here as they do on a card.
  if (mode === "progress") return (
    <div style={page}><div style={wrap}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
        <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:C.textMuted,cursor:"pointer"}}>← Menu</button>
        <span style={{color:C.textMuted,fontSize:"0.85rem"}}>{learned} of {total} mastered</span>
      </div>

      <h1 style={{...C.ui.h1,margin:"0 0 0.35rem",color:C.textStrong}}>Backup &amp; Reset</h1>
      <p style={{color:C.textFaint,fontSize:"0.78rem",lineHeight:1.6,marginTop:0,marginBottom:"1.5rem"}}>
        Your account keeps your <strong style={{color:C.textBody,fontWeight:700}}>maximum progress</strong> — the
        best you have ever reached, on any device. It only ever grows, so nothing
        that happens here can lower it and your progress can always be restored
        to that maximum.
      </p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.75rem",marginBottom:"1.75rem"}}>
        {[["Mastered",learned,C.success],["In deck",deck.length,C.info],["Tried",st.tried?.length||0,C.accent]].map(([l,v,c])=>(
          <div key={l} style={frame({borderRadius:12,padding:"0.9rem",textAlign:"center"})}>
            <div style={{fontSize:"1.75rem",fontWeight:800,color:c}}>{v}</div>
            <div style={{fontSize:"0.75rem",color:C.textMuted,marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      {/* What the saved copy actually holds, under the tiles saying what this
          device holds. The two being readable together is the whole point: the
          failure this screen could not show was a mark stuck at nothing beside a
          live account with real progress in it, and side by side that is obvious
          at a glance in a way no timestamp or status word would have been.

          Only for a signed-in user of a Firebase-configured build. There is no
          account to have a mark in otherwise, and the copy below already covers
          being signed out. */}
      {firebaseEnabled && user && (
        hwErr
          ? <div role="alert" style={frame({borderRadius:12,padding:"0.75rem 1rem",border:`1px solid ${C.dangerTextEdge}`,fontSize:"0.78rem",color:C.error,lineHeight:1.55,marginBottom:"1.25rem"})}>
              <strong style={{fontWeight:700}}>Your maximum isn't being saved.</strong>{" "}
              Everything you have is still safe on this device, but new progress
              is not reaching your account, so there may be nothing to restore
              from. ({hwErr})
            </div>
          : <div style={frame({borderRadius:12,padding:"0.7rem 1rem",border:`1px solid ${C.border}`,fontSize:"0.75rem",color:C.textFaint,lineHeight:1.55,marginBottom:"1.25rem"})}>
              {hwPeak
                ? <>Saved maximum: <strong style={{color:C.textBody,fontWeight:700}}>{hwPeak.learned} mastered</strong>, {hwPeak.tried} tried
                    {hwSavedAt ? ` — last incremented ${timeAgo(hwSavedAt)}.` : "."}</>
                : "Nothing saved yet. Your maximum is recorded automatically as you study, and this will fill in once it is."}
            </div>
      )}

      <button
        onClick={restoreOwnProgress}
        disabled={!firebaseEnabled || !user || selfBusy}
        style={{...btn(C.successDeep),width:"100%",marginBottom:"0.5rem",opacity:(!firebaseEnabled||!user||selfBusy)?0.5:1,cursor:(!firebaseEnabled||!user||selfBusy)?"not-allowed":"pointer"}}>
        {selfBusy ? "Restoring…" : "♻️ Restore Progress"}
      </button>
      <div style={{fontSize:"0.75rem",color:C.textFaint,lineHeight:1.55,marginBottom:"1.75rem"}}>
        {firebaseEnabled && user
          ? "Brings back your maximum progress. Nothing you have now is removed or lowered — anything already ahead of the saved copy is kept, so this is safe to press at any time."
          : "Sign in to restore. Your maximum progress is kept with your account, so there is nothing saved to restore from while you are signed out."}
      </div>

      <button onClick={reset} style={{...btn(C.danger),width:"100%",marginBottom:"0.5rem"}}>⚠️ Clear Progress</button>
      <div style={{fontSize:"0.75rem",color:C.textFaint,lineHeight:1.55,marginBottom:"1.25rem"}}>
        Erases every score, every cocktail you have mastered and every drink you
        have marked as tried — on this device and in your account.{" "}
        {firebaseEnabled && user
          ? "Your maximum progress is kept, so Restore Progress can bring this back."
          : "You are signed out, so there is no saved copy and this cannot be undone."}
      </div>

      {selfMsg && <div role="status" style={frame({borderRadius:12,padding:"0.75rem 1rem",border:`1px solid ${C.successEdge}`,fontSize:"0.78rem",color:C.textBody,lineHeight:1.55,marginBottom:"1.25rem"})}>{selfMsg}</div>}
      {selfErr && <div role="alert" style={frame({borderRadius:12,padding:"0.75rem 1rem",border:`1px solid ${C.dangerTextEdge}`,fontSize:"0.78rem",color:C.error,lineHeight:1.55,marginBottom:"1.25rem"})}>{selfErr}</div>}

      {/* Restore. The endpoint runs on the server with the Admin SDK, because
          firestore.rules deliberately forbids any client — an admin's included —
          from listing the users collection or reading someone else's document.

          No file changes hands. Progress and purchases are already backed up the
          moment they happen — a high-water mark that only ever grows, and a
          purchase ledger no client can even read — so this just merges those
          straight into the account. A restore can only ever ADD: scores take
          whichever value is higher, lists are unioned, and a purchase can be
          restored but never revoked. See docs/backup-restore.md. */}
      {isAdmin && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",marginBottom:"1.25rem"})}>
          <button onClick={()=>setShowBackup(v=>!v)} style={{background:"transparent",border:"none",color:C.accent,fontWeight:700,fontSize:"0.85rem",cursor:"pointer",padding:0}}>
            🛟 Restore Progress (admin) {showBackup ? "▲" : "▼"}
          </button>
          {showBackup && (
            <div style={{marginTop:"0.75rem"}}>
              <div style={{fontSize:"0.72rem",color:C.textFaint,marginBottom:"0.75rem",lineHeight:1.5}}>
                Every account's best-ever progress, and every purchase, already
                lives safely in Firestore. This merges that back into the account
                — nothing to download, nothing to upload.
              </div>

              <input
                value={restoreWho}
                onChange={e=>setRestoreWho(e.target.value)}
                placeholder="Email or uid — blank restores everyone"
                style={{width:"100%",boxSizing:"border-box",padding:"0.5rem 0.75rem",borderRadius:8,background:C.well,border:`1px solid ${C.border}`,color:C.textStrong,fontSize:"0.8rem",outline:"none",marginBottom:"0.6rem"}}
              />
              <div style={{display:"flex",gap:"0.5rem"}}>
                <button onClick={()=>runRestore(true)} disabled={Boolean(backupBusy)} style={{flex:1,padding:"0.5rem",borderRadius:8,background:"transparent",color:C.infoLite,fontWeight:600,fontSize:"0.78rem",border:`1px solid ${C.infoEdge}`,cursor:backupBusy?"not-allowed":"pointer"}}>
                  {backupBusy === "preview" ? "Checking…" : "Preview"}
                </button>
                <button onClick={()=>runRestore(false)} disabled={Boolean(backupBusy)} style={{flex:1,padding:"0.5rem",borderRadius:8,background:"transparent",color:C.accent,fontWeight:700,fontSize:"0.78rem",border:`1px solid ${C.accentEdge}`,cursor:backupBusy?"not-allowed":"pointer"}}>
                  {backupBusy === "restore" ? "Restoring…" : "Restore"}
                </button>
              </div>

              {backupMsg && <div style={{fontSize:"0.75rem",color:C.textMuted,marginTop:"0.6rem"}}>{backupMsg}</div>}
              {backupErr && <div style={{fontSize:"0.75rem",color:C.error,marginTop:"0.6rem"}}>{backupErr}</div>}

              {restoreResult && (
                <div style={{marginTop:"0.75rem",background:C.well,borderRadius:8,padding:"0.6rem 0.75rem"}}>
                  <div style={{fontSize:"0.78rem",fontWeight:700,color:restoreResult.dryRun?C.infoLite:C.success,marginBottom:"0.35rem"}}>
                    {restoreResult.dryRun ? "Preview — nothing was written" : "Restored"}
                  </div>
                  <div style={{fontSize:"0.75rem",color:C.textMuted,lineHeight:1.6}}>
                    {restoreResult.examined} account{restoreResult.examined === 1 ? "" : "s"} checked ·{" "}
                    {restoreResult.changed} {restoreResult.dryRun ? "would change" : "changed"}
                    {restoreResult.proRestored > 0 && ` · ${restoreResult.proRestored} Pro ${restoreResult.dryRun ? "would be" : ""} restored`}
                  </div>
                  <div style={{marginTop:"0.4rem",maxHeight:150,overflowY:"auto",display:"flex",flexDirection:"column",gap:"0.25rem"}}>
                    {restoreResult.details?.map(d => (
                      <div key={d.uid} style={{fontSize:"0.72rem",color:C.textBody}}>
                        {d.email || d.uid}: +{d.learnedAdded} learned, +{d.triedAdded} tried, {d.scoresRaised} scores raised
                        {d.proRestored && <span style={{color:C.accent}}> · Pro restored</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div></div>
  );

  if (mode === "menu") return (
    <div style={page}><div style={wrap}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.15rem"}}>
        <h1 style={{...C.ui.h1,margin:0,color:C.textStrong}}>🍹 Cocktail Flashcards</h1>
        <span style={{fontSize:"0.7rem",color:C.success}}>{saved}</span>
      </div>
      <p style={{color:C.textFaint,fontSize:"0.72rem",marginBottom:"0.75rem"}}>Drinks International Bestselling Classics 2026</p>

      {authReady && (
        <div style={frame({borderRadius:12,padding:"0.75rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",flexWrap:"wrap",rowGap:"0.6rem"})}>
          {user ? (
            <>
              <div style={{display:"flex",alignItems:"center",gap:"0.6rem",minWidth:0}}>
                {user.photoURL && <img src={user.photoURL} alt="" style={{width:28,height:28,borderRadius:"50%"}} />}
                <div style={{fontSize:"0.8rem",color:C.textBody,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.displayName || user.email}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"0.6rem"}}>
                <button onClick={signOutUser} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.textMuted,borderRadius:8,padding:"0.4rem 0.7rem",fontSize:"0.75rem",cursor:"pointer"}}>Sign out</button>
              </div>
              {/* "Delete account" used to sit next to Sign out, one mis-tap away from
                  wiping an account. It now lives in the footer — see below. */}
            </>
          ) : (
            <>
              <div style={{fontSize:"0.8rem",color:C.textMuted}}>{firebaseEnabled ? "Sign in to sync progress" : "Cloud sync not configured"}</div>
              <div style={{display:"flex",flexDirection:"column",gap:"0.4rem"}}>
                <button onClick={() => signIn(googleProvider)} disabled={!firebaseEnabled} style={{background:firebaseEnabled?"#ffffff":C.surfaceDisabled,color:firebaseEnabled?C.well:C.textFaint,border:"none",borderRadius:8,padding:"0.4rem 0.75rem",fontSize:"0.8rem",fontWeight:600,cursor:firebaseEnabled?"pointer":"not-allowed"}}>🔐 Sign in with Google</button>
                {googleErr && (
                  <div role="alert" style={{color:C.error,fontSize:"0.7rem"}}>
                    {googleErr}
                    {googleErrDetail && (
                      <div style={{color:C.textFaint,fontSize:"0.65rem",marginTop:"0.25rem",wordBreak:"break-word",userSelect:"text"}}>
                        {googleErrDetail}
                      </div>
                    )}
                  </div>
                )}
                {FACEBOOK_LOGIN_ENABLED && <button onClick={signInFacebook} disabled={!firebaseEnabled} style={{background:firebaseEnabled?"#1877F2":C.surfaceDisabled,color:firebaseEnabled?"#ffffff":C.textFaint,border:"none",borderRadius:8,padding:"0.4rem 0.75rem",fontSize:"0.8rem",fontWeight:600,cursor:firebaseEnabled?"pointer":"not-allowed"}}>Sign in with Facebook</button>}
              </div>
              {/* The password form used to sit here as "Use email instead". It now
                  lives in the footer as "Admin login" — see below. */}
            </>
          )}
        </div>
      )}

      {FEATURES.stripePurchase && firebaseEnabled && authReady && !adFree && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",gap:"0.75rem"})}>
          <div style={{fontSize:"0.8rem",color:C.textMuted}}>
            {webAdsServed
              ? `Go Pro — all ${ALL_CARDS.length} cocktails, and no ads`
              : `Go Pro — study and quiz all ${ALL_CARDS.length} cocktails`}
          </div>
          <button onClick={startCheckout} disabled={purchasing || !user} style={{background:user?C.success:C.surfaceDisabled,color:user?C.well:C.textFaint,border:"none",borderRadius:8,padding:"0.5rem 0.9rem",fontSize:"0.8rem",fontWeight:700,cursor:user?"pointer":"not-allowed",whiteSpace:"nowrap"}}>
            {purchasing ? "Redirecting…" : `✨ Get Pro — ${PRO_PRICE}`}
          </button>
        </div>
      )}
      {/* Play (Capacitor) build: RevenueCat paywall + restore. Gated on
          billingReady, not FEATURES.nativePurchase — see above. */}
      {billingReady && !adFree && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",display:"flex",flexDirection:"column",marginBottom:"1.25rem",gap:"0.75rem"})}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"0.75rem"}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:"0.8rem",color:C.textMuted}}>
              {firebaseEnabled && !user ? "Sign in, then go Pro — it carries over to the web" : `Cocktail Flashcards Pro — all ${ALL_CARDS.length} cocktails, no ads`}
            </div>
            <button onClick={restoreAdsNative} style={{background:"transparent",border:"none",color:C.textFaint,fontSize:"0.72rem",cursor:"pointer",padding:"0.2rem 0",textDecoration:"underline"}}>Restore purchase</button>
          </div>
          <button onClick={buyRemoveAdsNative} disabled={purchasing || awaitingIdentity} style={{background:(purchasing||awaitingIdentity)?C.surfaceDisabled:C.success,color:(purchasing||awaitingIdentity)?C.textFaint:C.well,border:"none",borderRadius:8,padding:"0.5rem 0.9rem",fontSize:"0.8rem",fontWeight:700,cursor:(purchasing||awaitingIdentity)?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
            {purchasing ? "Processing…" : awaitingIdentity ? "Connecting…" : "✨ Go Pro"}
          </button>
        </div>
        {/* Stands in for the console this build has no way to reach. Shown only
            when linking actually failed, and it names the step, the SDK's own
            message, and the few facts that separate the causes: a missing key, a
            key with whitespace on it, the wrong entitlement id, or no bridge. */}
        {(billingErr || awaitingIdentity) && (() => {
          const d = getBillingDiagnostics();
          const rows = [
            ["failed at", billingErr ? billingErr.step : "nothing reported — still waiting"],
            ["message", billingErr ? billingErr.message : "The link has not come back yet."],
            ["code", (billingErr && billingErr.code) || "—"],
            ["sdk key", d.keySet ? `${d.keyPrefix}… (${d.keyLength} chars)` : "MISSING"],
            ["key whitespace", d.keyStripped ? `${d.keyStripped} stray character(s) trimmed — fix the env var` : "none"],
            ["entitlement", d.entitlement],
            ["native bridge", d.bridge ? "present" : "absent"],
            ["stopped at", d.stage],
            ["purchases plugin", d.purchasesPlugin ? "in this build" : "MISSING from this build"],
            ["plugins present", d.pluginList],
            ["build", typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "unknown"],
          ];
          return (
            <div role="alert" style={{borderTop:`1px solid ${C.border}`,paddingTop:"0.65rem"}}>
              <div style={{color:billingErr?C.error:C.accent,fontSize:"0.75rem",fontWeight:700,marginBottom:"0.45rem"}}>
                {billingErr ? "Couldn't link this account to the store" : "Still connecting to the store"}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"0.15rem",fontSize:"0.68rem",userSelect:"text"}}>
                {rows.map(([k,v]) => (
                  <div key={k} style={{display:"flex",gap:"0.6rem"}}>
                    <span style={{color:C.textFaint,width:"7.5rem",flex:"none"}}>{k}</span>
                    <span style={{color:C.textBody,wordBreak:"break-word",minWidth:0}}>{String(v)}</span>
                  </div>
                ))}
              </div>
              <div style={{color:C.textFaint,fontSize:"0.68rem",marginTop:"0.5rem"}}>
                Linking is attempted once per launch, so force-stop and reopen the app after changing anything.
              </div>
            </div>
          );
        })()}
        </div>
      )}
      {/* Already Pro in the Play build: Customer Center handles restore, refund
          requests, and subscription management without a support email. */}
      {billingReady && adFree && adsRemovedNative && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",gap:"0.75rem"})}>
          <div style={{fontSize:"0.8rem",color:C.textMuted}}>✨ Cocktail Flashcards Pro is active</div>
          <button onClick={openCustomerCenter} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.textMuted,borderRadius:8,padding:"0.5rem 0.9rem",fontSize:"0.8rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
            Manage purchase
          </button>
        </div>
      )}
      {purchaseMsg && (
        <div style={{fontSize:"0.75rem",color:C.textMuted,marginBottom:"1rem",marginTop:"-0.75rem"}}>{purchaseMsg}</div>
      )}

      {isAdmin && (
        <div style={frame({borderRadius:12,padding:"0.9rem 1rem",marginBottom:"1.25rem"})}>
          <button onClick={()=>setShowAdAdmin(s=>!s)} style={{background:"transparent",border:"none",color:C.accent,fontWeight:700,fontSize:"0.85rem",cursor:"pointer",padding:0}}>
            🛡️ Ad Whitelist (admin) {showAdAdmin ? "▲" : "▼"}
          </button>
          {showAdAdmin && (
            <div style={{marginTop:"0.75rem"}}>
              <div style={{display:"flex",gap:"0.5rem",marginBottom:"0.5rem"}}>
                <input
                  value={whitelistInput}
                  onChange={e=>setWhitelistInput(e.target.value)}
                  placeholder="user@gmail.com"
                  style={{flex:1,padding:"0.5rem 0.75rem",borderRadius:8,background:C.well,border:`1px solid ${C.border}`,color:C.textStrong,fontSize:"0.85rem",outline:"none"}}
                />
                <button onClick={addToWhitelist} style={{...btn(C.accent),color:C.well,padding:"0.5rem 0.9rem",fontSize:"0.8rem"}}>Add</button>
              </div>
              {whitelistMsg && <div style={{fontSize:"0.75rem",color:C.textMuted,marginBottom:"0.5rem"}}>{whitelistMsg}</div>}
              <div style={{display:"flex",flexDirection:"column",gap:"0.4rem",maxHeight:160,overflowY:"auto"}}>
                {whitelist.length === 0 && <div style={{color:C.textFaint,fontSize:"0.8rem"}}>No whitelisted users yet.</div>}
                {whitelist.map(w => (
                  <div key={w.email} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.well,borderRadius:8,padding:"0.4rem 0.6rem"}}>
                    <span style={{fontSize:"0.8rem",color:C.textBody}}>{w.email}</span>
                    <button onClick={()=>removeFromWhitelist(w.email)} style={{background:"transparent",border:"none",color:C.dangerText,cursor:"pointer",fontSize:"0.75rem"}}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.75rem",marginBottom:"1.25rem"}}>
        {[["Learned",learned,C.success],["Active",deck.length,C.info],["Total",total,C.accent]].map(([l,v,c])=>(
          <div key={l} style={frame({borderRadius:12,padding:"0.9rem",textAlign:"center"})}>
            <div style={{fontSize:"1.75rem",fontWeight:800,color:c}}>{v}</div>
            <div style={{fontSize:"0.75rem",color:C.textMuted,marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      <div style={frame({borderRadius:99,height:8,marginBottom:"1.75rem",overflow:"hidden"})}>
        <div style={{background:C.success,height:"100%",width:`${(learned/total)*100}%`,transition:"width 0.5s"}} />
      </div>

      <button onClick={()=>{setDi(0);setRevealed(false);setMode("study");}} style={{...btn(C.navStudy),width:"100%",marginBottom:"0.75rem"}}>📚 Study Mode</button>
      <button onClick={()=>{setQuizKind("self");setMode("quizlen");}} style={{...btn(C.navQuiz),width:"100%",marginBottom:"0.75rem"}}>🎯 Self Quiz — Test Yourself</button>
      <button onClick={()=>{setQuizKind("86");setMode("quizlen");}} style={{...btn(C.navEightySix),width:"100%",marginBottom:"0.75rem"}}>🍸 86 It — Spot the Impostors</button>
      <button onClick={()=>{setSearch("");setMode("index");}} style={{...btn(C.navIndex),width:"100%",marginBottom:"0.75rem"}}>🔍 Index — Search Cocktails</button>
      {/* Deliberately the smallest thing in the stack, and last. Nothing here is
          somewhere you go to study — it is where you go once something has gone
          wrong — so it sits below every control that is, in a quiet face rather
          than a colour that competes with them. */}
      <button onClick={()=>{setSelfMsg("");setSelfErr("");setMode("progress");}} style={{...btn(C.surfaceQuiet),width:"100%",padding:"0.6rem",fontSize:"0.85rem",marginBottom:"1.5rem",border:`1px solid ${C.border}`}}>Backup &amp; Reset</button>

      {/* The paywall itself. Study and quizzes cover the top 50 for free; this
          switch is what adds the rest of the book to both. Without Pro it isn't a
          switch that refuses to move — it's the way in to the purchase. */}
      <div style={frame({borderRadius:12,padding:"1rem 1.25rem",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"0.75rem",gap:"0.75rem"})}>
        <div style={{minWidth:0}}>
          <div style={{fontWeight:700,color:C.textStrong}}>{isPro ? "" : "🔒 "}Add All {ALL_CARDS.length} Cards</div>
          <div style={{fontSize:"0.75rem",color:C.textMuted}}>
            {isPro
              ? `Study and quiz the whole book, not just the top ${top50.length}`
              : `Free covers the top ${top50.length} — Pro adds the other ${master150.length}`}
          </div>
        </div>
        {isPro ? (
          <button onClick={toggleMaster} aria-pressed={masterOn} aria-label={`Add all ${ALL_CARDS.length} cards`} style={{width:52,height:28,borderRadius:99,border:"none",cursor:"pointer",position:"relative",flexShrink:0,background:masterOn?C.accent:C.surfaceDisabled,transition:"background 0.3s"}}>
            <div style={{position:"absolute",top:3,left:masterOn?27:3,width:22,height:22,borderRadius:"50%",background:C.textOnFill,transition:"left 0.3s"}} />
          </button>
        ) : (
          <button onClick={unlockPro} disabled={purchasing} style={{background:purchasing?C.surfaceDisabled:C.accent,color:purchasing?C.textFaint:C.well,border:"none",borderRadius:8,padding:"0.5rem 0.9rem",fontSize:"0.8rem",fontWeight:700,cursor:purchasing?"not-allowed":"pointer",whiteSpace:"nowrap",flexShrink:0}}>
            {purchasing ? "…" : "✨ Unlock"}
          </button>
        )}
      </div>
      <div style={{marginTop:"1.5rem"}}>
        <div style={{fontSize:"0.68rem",letterSpacing:"0.16em",textTransform:"uppercase",color:C.textFaint,marginBottom:"0.5rem"}}>Colour scheme</div>
        <div role="group" aria-label="Colour scheme" style={{display:"flex",gap:"0.6rem"}}>
          {["retro","future"].map(t => {
            const sw = THEME_SWATCH[t], on = theme === t;
            return (
              <button key={t} onClick={()=>setTheme(t)} aria-pressed={on}
                style={{flex:1,padding:"0.75rem 0.5rem",borderRadius:10,cursor:"pointer",
                  background:sw.bg, color:sw.fg, fontFamily:sw.font, fontWeight:700,
                  fontSize:"0.95rem", letterSpacing:sw.tracking, textTransform:sw.transform,
                  border:`2px solid ${on ? sw.ring : "transparent"}`,
                  boxShadow:on ? sw.glow : "none",
                  opacity:on ? 1 : 0.55,
                  transition:"opacity 0.2s, box-shadow 0.2s"}}>
                {sw.label}
              </button>
            );
          })}
        </div>
      </div>
      {/* Below every control and above the legal footer: the one band of this
          screen where a mis-tap costs a stray ad click rather than a reset, and
          where holding space open pushes nothing the user was aiming at. */}
      {webAdsEligible && <AdSlot placement="menu" />}
      {/* Reference material for adults, not an invitation to drink — states the
          age expectation the store content rating is filed under. */}
      <div style={{textAlign:"center",marginTop:"1.25rem",fontSize:"0.75rem",color:C.textFaint}}>
        Intended for ages 21+. Please drink responsibly.
      </div>
      <div style={{textAlign:"center",marginTop:"0.75rem",fontSize:"0.75rem",color:C.textFaint}}>
        Questions or feedback? <a href="mailto:steve@cocktailflashcards.com" style={{color:C.textMuted}}>steve@cocktailflashcards.com</a>
      </div>
      {/* Play requires the policy to be reachable from inside the app, not just
          from the store listing. Served as a static page, so it renders even if
          the app bundle fails. Withdrawing consent must be as easy as giving it,
          hence the second link — on Android it opens Google's own UMP privacy
          form instead, since that's where the choice was made. */}
      <div style={{textAlign:"center",marginTop:"0.5rem",fontSize:"0.75rem",color:C.textFaint,display:"flex",gap:"0.75rem",justifyContent:"center",flexWrap:"wrap"}}>
        <a href="/privacy" style={{color:C.textFaint}}>Privacy Policy</a>
        {FEATURES.ads && gdprApplies && (
          <button onClick={openPrivacySettings} style={{background:"transparent",border:"none",color:C.textFaint,fontSize:"0.75rem",cursor:"pointer",padding:0,textDecoration:"underline"}}>
            Privacy &amp; cookie settings
          </button>
        )}
        {FEATURES.nativeAds && privacyOptionsRequired && (
          <button onClick={openAdPrivacyOptions} style={{background:"transparent",border:"none",color:C.textFaint,fontSize:"0.75rem",cursor:"pointer",padding:0,textDecoration:"underline"}}>
            Ad privacy options
          </button>
        )}
      </div>

      {/* Delete account — deliberately down here rather than beside "Sign out",
          where a mis-tap could wipe an account that cannot be recovered. Play
          still requires deletion to be reachable in-app, and the policy page
          names this location, so it stays a plain visible control: buried, not
          hidden. The toggle only reveals the confirmation; nothing is destroyed
          until "Yes, delete everything". Shown only when signed in. */}
      {firebaseEnabled && authReady && user && (
        <div style={{textAlign:"center",marginTop:"0.5rem"}}>
          <button onClick={() => { setDeleteConfirm(v => !v); setDeleteErr(""); }} aria-expanded={deleteConfirm} style={{background:"transparent",border:"none",color:C.textGhost,fontSize:"0.72rem",cursor:"pointer",padding:0,textDecoration:"underline"}}>
            {deleteConfirm ? "Cancel" : "Delete account"}
          </button>
          {deleteConfirm && (
            <div style={{maxWidth:300,margin:"0.6rem auto 0"}}>
              <div style={{fontSize:"0.75rem",color:C.textBody,marginBottom:"0.5rem"}}>
                Permanently delete your account and synced progress? This cannot be undone
                {adFree ? ", and your Pro access will be removed from this account" : ""}.
                {adFree && billingReady ? " You can get it back with Restore purchase." : ""}
              </div>
              <div style={{display:"flex",gap:"0.4rem",alignItems:"center",justifyContent:"center",flexWrap:"wrap"}}>
                <button onClick={deleteAccount} disabled={deleteBusy} style={{background:deleteBusy?C.surfaceDisabled:C.dangerDeep,color:deleteBusy?C.textFaint:C.textOnFill,border:"none",borderRadius:8,padding:"0.4rem 0.75rem",fontSize:"0.78rem",fontWeight:600,cursor:deleteBusy?"not-allowed":"pointer"}}>
                  {deleteBusy ? "Deleting…" : "Yes, delete everything"}
                </button>
                <button onClick={() => { setDeleteConfirm(false); setDeleteErr(""); }} disabled={deleteBusy} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.textMuted,borderRadius:8,padding:"0.4rem 0.7rem",fontSize:"0.78rem",cursor:deleteBusy?"not-allowed":"pointer"}}>Cancel</button>
              </div>
              {deleteErr && <div role="alert" style={{color:C.error,fontSize:"0.7rem",marginTop:"0.4rem"}}>{deleteErr}</div>}
            </div>
          )}
        </div>
      )}

      {/* Admin login — the password sign-in, moved out of the account card so
          Google stays the only visible choice for ordinary users. Still the
          credentials path for Play Console's App access reviewers, whose OAuth
          sign-ins trip Google's security challenges, so the App access notes
          need to name this link. Hidden once anyone is signed in. */}
      {firebaseEnabled && authReady && !user && (
        <div style={{textAlign:"center",marginTop:"0.5rem"}}>
          <button onClick={() => { setShowEmailForm(v => !v); setEmailErr(""); }} aria-expanded={showEmailForm} style={{background:"transparent",border:"none",color:C.textGhost,fontSize:"0.72rem",cursor:"pointer",padding:0,textDecoration:"underline"}}>
            {showEmailForm ? "Cancel" : "Admin login"}
          </button>
          {showEmailForm && (
            <form onSubmit={signInEmail} style={{display:"flex",flexDirection:"column",gap:"0.4rem",maxWidth:260,margin:"0.6rem auto 0"}}>
              <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="Email" required autoComplete="username" style={stackedField} />
              <input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} placeholder="Password" required autoComplete="current-password" style={stackedField} />
              <button type="submit" disabled={emailBusy} style={{background:emailBusy?C.surfaceDisabled:C.textGhost,color:emailBusy?C.textFaint:C.textBody,border:"none",borderRadius:8,padding:"0.4rem 0.75rem",fontSize:"0.8rem",fontWeight:600,cursor:emailBusy?"not-allowed":"pointer"}}>
                {emailBusy ? "Signing in…" : "Sign in"}
              </button>
              {emailErr && <div role="alert" style={{color:C.error,fontSize:"0.7rem"}}>{emailErr}</div>}
            </form>
          )}
        </div>
      )}
    </div></div>
  );

  if (mode === "index") {
    const q = norm(search.trim());
    // Match on both the cocktail name and its ingredient list, accent-insensitively,
    // so "pina" finds "Piña Colada" and "rum" finds every drink containing rum.
    const matches = q ? ALL_CARDS.filter(c => norm(c.name).includes(q) || norm(c.ingredients).includes(q)) : ALL_CARDS;
    const triedSet = new Set(st.tried || []);
    const results = triedFilter === "all"
      ? matches
      : matches.filter(c => triedSet.has(c.name) === (triedFilter === "tried"));
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:C.textMuted,cursor:"pointer"}}>← Menu</button>
          <span style={{color:C.textMuted,fontSize:"0.85rem"}}>{results.length} of {ALL_CARDS.length}{triedFilter !== "all" ? ` · ${triedSet.size} tried` : ""}</span>
        </div>
        <input
          autoFocus
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Search name or ingredient…"
          style={frame({width:"100%",boxSizing:"border-box",padding:"0.85rem 1rem",borderRadius:12,border:`1px solid ${C.border}`,color:C.textStrong,fontSize:"1rem",marginBottom:"0.6rem",outline:"none"})}
        />
        <div style={{display:"flex",gap:"0.5rem",marginBottom:isPro?"1.25rem":"0.6rem"}}>
          {[["all","All"],["tried","☑ Tried"],["untried","☐ Not tried"]].map(([k,label])=>(
            <button key={k} onClick={()=>setTriedFilter(k)} aria-pressed={triedFilter===k}
              style={{flex:1,borderRadius:10,padding:"0.5rem",fontSize:"0.75rem",fontWeight:700,cursor:"pointer",
                border: triedFilter===k ? "none" : `1px solid ${C.borderStrong}`,
                background: triedFilter===k ? C.accentAlt : "transparent",
                color: triedFilter===k ? C.textOnFill : C.textMuted}}>{label}</button>
          ))}
        </div>
        {/* The Index is the whole book either way — the lock says which of these
            recipes can also go into a deck, so a locked button reads as a price
            rather than as a bug. */}
        {!isPro && (
          <div style={{fontSize:"0.72rem",color:C.textFaint,marginBottom:"1.25rem"}}>
            Every recipe is here to read. Study and quizzes cover the top {top50.length} — 🔒 marks the rest.
          </div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:"0.75rem",maxHeight:"60vh",overflowY:"auto"}}>
          {results.length === 0 && (
            <div style={{color:C.textFaint,textAlign:"center",padding:"2rem 0"}}>{triedFilter === "tried" ? "No tried cocktails match." : triedFilter === "untried" ? "Nothing left untried here." : "No cocktails found."}</div>
          )}
          {results.map(c=>{
            // Outside the pool the cocktail is readable but not studiable: Pro
            // buys it, and a Pro user who simply has the library switched off
            // gets it switched on by adding one of its cocktails (toggleStudy).
            const locked = !poolNames.has(c.name) && !isPro;
            const inDeck = deck.includes(c.name);
            return (
            <div key={c.name} style={frame({borderRadius:14,padding:"1rem 1.25rem"})}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.4rem",gap:"0.5rem"}}>
                <h3 style={{fontSize:"1.1rem",fontWeight:800,color:C.textStrong,margin:0}}>{c.name}</h3>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:"0.35rem"}}>
                  {c.rank && <span style={{fontSize:"0.7rem",color:C.accent,fontWeight:600,whiteSpace:"nowrap"}}>#{c.rank}</span>}
                  <button onClick={()=>toggleStudy(c.name)} title={locked ? `Pro adds all ${ALL_CARDS.length} cocktails to study and quizzes` : undefined} style={{whiteSpace:"nowrap",borderRadius:8,padding:"0.3rem 0.6rem",fontSize:"0.72rem",fontWeight:700,cursor:"pointer",border:inDeck?"none":`1px solid ${locked?C.accentEdge:C.infoEdge}`,background:inDeck?C.successDeep:"transparent",color:inDeck?C.textOnFill:locked?C.accent:C.infoLite}}>
                    {locked ? "🔒 Pro" : inDeck ? "✓ In Study" : "＋ Study"}
                  </button>
                  {triedChip(c.name, false)}
                </div>
              </div>
              <div style={{color:C.textBody,lineHeight:1.7,fontSize:"0.85rem"}}>
                {c.glass && <div style={{padding:"0.05rem 0",borderBottom:`1px solid ${C.borderFaint}`,color:C.textMuted}}>{glassIcon(c.glass)} {c.glass} • {getMethod(c)}{c.serve ? " • " + c.serve : ""}</div>}
                {c.ingredients.split(", ").map((g,i,a)=>(
                  <div key={i} style={{padding:"0.05rem 0",borderBottom:i<a.length-1?`1px solid ${C.borderFaint}`:"none"}}>{g}</div>
                ))}
              </div>
            </div>
            );
          })}
        </div>
        {/* Outside the scroll container, not inside it: an ad that scrolled with
            the results would be re-measured on every scroll and sits among the
            "＋ Study" buttons. Here it is a fixed band under a list that has its
            own 60vh box, so reserving space costs the results nothing. */}
        {webAdsEligible && <AdSlot placement="index" />}
      </div></div>
    );
  }

  if (mode === "study") {
    if (deck.length === 0) {
      const allMastered = learned >= total;
      return (
        <div style={{...page,justifyContent:"center"}}>
          <div style={{fontSize:"3rem",marginBottom:"1rem"}}>{allMastered ? "🏆" : "🃏"}</div>
          <h2 style={{fontWeight:800,marginBottom:"0.5rem"}}>{allMastered ? "All Mastered!" : "Your deck is empty"}</h2>
          <p style={{color:C.textMuted,marginBottom:"2rem",textAlign:"center"}}>
            {allMastered ? `You've learned all ${total} cocktails.` : "Add some cocktails from the Index to start studying."}
          </p>
          <div style={{display:"flex",gap:"0.75rem"}}>
            {!allMastered && <button onClick={()=>{setSearch("");setMode("index");}} style={btn(C.navIndex,{padding:"0.75rem 1.5rem"})}>🔍 Index</button>}
            <button onClick={()=>setMode("menu")} style={btn(C.info,{padding:"0.75rem 1.5rem"})}>Back to Menu</button>
          </div>
          {/* Nothing left to study is the one moment a bigger library is
              obviously worth something, so say so here rather than only on the
              menu. */}
          {allMastered && !isPro && (
            <button onClick={unlockPro} style={{marginTop:"1rem",padding:"0.7rem 1.2rem",borderRadius:12,background:"transparent",color:C.accent,fontWeight:700,fontSize:"0.85rem",border:`1px solid ${C.accentSoft}`,cursor:"pointer"}}>
              🔒 Add the other {master150.length} with Pro
            </button>
          )}
        </div>
      );
    }
    // Clamp here, not only in the effect: a live sync can shrink the deck and
    // this render happens before the effect corrects the index. ALL_CARDS is the
    // last resort for the lookup — `deck` is already pool-only, so it should
    // never be needed, and a card that renders blank would be worse than one
    // found the long way.
    const cardIdx = Math.min(di, deck.length - 1);
    const ci = deck[cardIdx], c = pool.find(x => x.name === ci) || ALL_CARDS.find(x => x.name === ci), score = st.scores[ci]||0;
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:C.textMuted,cursor:"pointer"}}>← Menu</button>
          <span style={{color:C.textMuted,fontSize:"0.85rem"}}>{learned}/{total} learned</span>
          <span style={{color:C.textMuted,fontSize:"0.85rem"}}>Card {cardIdx+1}/{deck.length}</span>
        </div>

        <div style={frame({borderRadius:20,padding:"2rem",marginBottom:"1.25rem",minHeight:280,display:"flex",flexDirection:"column",justifyContent:"space-between"})}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <h2 style={{fontSize:"1.5rem",fontWeight:800,color:C.textStrong,margin:0,lineHeight:1.2}}>{c.name}</h2>
              {c.rank && <div style={{fontSize:"0.7rem",color:C.accent,marginTop:"0.25rem",fontWeight:600}}>#{c.rank} DI 2026</div>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"0.5rem",marginLeft:"0.75rem"}}>
              {triedChip(c.name, true)}
              <div style={{background:col(score),color:C.well,borderRadius:99,padding:"0.2rem 0.6rem",fontSize:"0.85rem",fontWeight:700,whiteSpace:"nowrap"}}>{score}/{MASTERY_SCORE}</div>
            </div>
          </div>
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem 0"}}>
            {!revealed
              ? <button onClick={()=>setRevealed(true)} style={btn(C.surfaceQuiet,{color:C.textBody,fontSize:"0.95rem"})}>Reveal Ingredients</button>
              : <div style={{color:C.textBody,lineHeight:1.85,fontSize:"0.9rem"}}>
                  {c.glass && <div style={{padding:"0.1rem 0",borderBottom:`1px solid ${C.borderFaint}`,color:C.textMuted}}>{glassIcon(c.glass)} {c.glass} • {getMethod(c)}{c.serve ? " • " + c.serve : ""}</div>}
                  {c.ingredients.split(", ").map((g,i,a)=>(
                    <div key={i} style={{padding:"0.1rem 0",borderBottom:i<a.length-1?`1px solid ${C.borderFaint}`:"none"}}>{g}</div>
                  ))}
                </div>
            }
          </div>
        </div>

        {revealed
          ? <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem",marginBottom:"1rem"}}>
              <button onClick={()=>grade(true)} style={btn(C.successDeep)}>✓ Got It</button>
              <button onClick={()=>grade(false)} style={btn(C.danger)}>✗ Missed It</button>
            </div>
          : <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.75rem"}}>
              <button onClick={prev} style={btn(C.surfaceQuiet,{color:C.textMuted})}>← Prev</button>
              <button onClick={shuffleActive} style={btn(C.surfaceQuiet,{color:C.textMuted})}>🔀 Shuffle</button>
              <button onClick={next} style={btn(C.surfaceQuiet,{color:C.textMuted})}>Next →</button>
            </div>
        }

        <div style={{display:"flex",gap:4,marginTop:"1.25rem",flexWrap:"wrap",justifyContent:"center"}}>
          {deck.map((ci,i)=>(
            <div key={i} onClick={()=>{setDi(i);setRevealed(false);}}
              style={{width:28,height:28,borderRadius:6,background:i===cardIdx?C.info:C.surfaceQuiet,border:`2px solid ${col(st.scores[ci]||0)}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.65rem",color:C.textMuted,fontWeight:700}}>
              {st.scores[ci]||0}
            </div>
          ))}
        </div>

        <div style={frame({borderRadius:12,padding:"0.85rem 1rem",marginTop:"1.25rem"})}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.5rem"}}>
            <div style={{fontSize:"0.8rem",fontWeight:700,color:C.textBody}}>Deck Size</div>
            <div style={{fontSize:"0.9rem",fontWeight:800,color:C.info}}>{deckSize >= total ? "All" : deckSize}</div>
          </div>
          <div style={{display:"flex",gap:"0.4rem"}}>
            {[10,20,30,50].filter(n=>n<total).map(n=>{
              const on = deckSize === n && deckSize < total;
              return <button key={n} onClick={()=>setDeckSizeTo(n)} style={{flex:1,padding:"0.45rem",borderRadius:8,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.8rem",background:on?C.info:C.surfaceQuiet,color:on?C.textOnFill:C.textMuted}}>{n}</button>;
            })}
            <button onClick={()=>setDeckSizeTo(total)} style={{flex:1,padding:"0.45rem",borderRadius:8,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.8rem",background:deckSize>=total?C.info:C.surfaceQuiet,color:deckSize>=total?C.textOnFill:C.textMuted}}>All</button>
          </div>
        </div>
      </div></div>
    );
  }

  // Length picker, shown on the way into a quiz. A quiz over the whole book is a
  // sitting few people want, so the length is asked for up front rather than
  // buried in settings. Lengths at or past the pool size are dropped — they'd be
  // duplicate "All" buttons (in the free 50-cocktail pool, "50" IS all of them).
  if (mode === "quizlen") {
    const lengths = [10, 20, 50].filter(n => n < total);
    const opt = (label, sub, onClick, bg) => (
      <button key={label} onClick={onClick} style={{...btn(bg),width:"100%",marginBottom:"0.75rem",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>{label}</span>
        <span style={{fontSize:"0.8rem",fontWeight:600,opacity:0.75}}>{sub}</span>
      </button>
    );
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.75rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:C.textMuted,cursor:"pointer"}}>← Menu</button>
        </div>
        <div style={{textAlign:"center",marginBottom:"1.75rem"}}>
          <div style={{fontSize:"2.5rem",marginBottom:"0.5rem"}}>{quizKind === "86" ? "🍸" : "🎯"}</div>
          <h2 style={{fontSize:"1.75rem",fontWeight:800,margin:"0 0 0.35rem"}}>How Long?</h2>
          <p style={{color:C.textMuted,fontSize:"0.85rem",margin:0}}>
            {quizKind === "86"
              ? "86 It — drawn at random from all " + total + "."
              : "Cocktails are drawn at random from all " + total + "."}
          </p>
        </div>
        {lengths.map(n => opt(`${n} Questions`, "", ()=>startPicked(n), quizKind === "86" ? C.danger : C.accentAlt))}
        {opt("All Cocktails", `${total} questions`, ()=>startPicked(null), quizKind === "86" ? C.dangerDeep : C.accentAltDeep)}
        {/* Says what a bigger round would cost, at the moment the user is
            picking how much to take on — not as an interruption to the quiz
            itself. Amber whichever quiz this is: it is the Pro colour
            everywhere else in the app. */}
        {!isPro && (
          <button onClick={unlockPro} style={{width:"100%",marginTop:"0.5rem",padding:"0.7rem",borderRadius:12,background:"transparent",color:C.accent,fontWeight:700,fontSize:"0.85rem",border:`1px solid ${C.accentSoft}`,cursor:"pointer"}}>
            🔒 {quizKind === "86" ? "86" : "Quiz"} all {ALL_CARDS.length} cocktails with Pro
          </button>
        )}
      </div></div>
    );
  }

  // 86 It play screen. Everything starts checked; unchecking is the answer.
  // After Check Answer the same list is marked up rather than replaced, so the
  // drink is read twice — once as you believed it, once as it is.
  if (mode === "quiz" && quizKind === "86") {
    const c = quizPool[qi];
    if (!c) return <div style={page}><div style={wrap}>No cocktails available.</div></div>;
    const gotIt = qr && c.options.every((o, i) => kept[i] === o.real);
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:C.textMuted,cursor:"pointer"}}>← Menu</button>
          <span style={{color:C.textMuted,fontSize:"0.85rem"}}>{qi+1} / {quizPool.length}</span>
          <span style={{color:C.success,fontWeight:700}}>{qa.filter(Boolean).length} ✓</span>
        </div>
        <div style={frame({borderRadius:99,height:6,marginBottom:"1.5rem",overflow:"hidden"})}>
          <div style={{background:C.danger,height:"100%",width:`${(qi/quizPool.length)*100}%`,transition:"width 0.3s"}} />
        </div>

        <div style={frame({borderRadius:20,padding:"1.5rem",marginBottom:"1.25rem"})}>
          <h2 style={{fontSize:"1.5rem",fontWeight:800,color:C.textStrong,margin:"0 0 0.25rem"}}>{c.name}</h2>
          <div style={{color:C.textMuted,fontSize:"0.8rem",marginBottom:"1rem"}}>
            {qr ? (gotIt ? "✓ Correct" : "✗ Not quite") : "Uncheck anything that doesn't belong."}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"0.5rem"}}>
            {c.options.map((o,i)=>{
              const on = kept[i];
              // Before answering, the box just reflects the player. After, it
              // says what was true: green where they agreed with the recipe,
              // red where they did not.
              const right = qr && on === o.real;
              const bg = qr ? (right ? C.successWash : C.dangerWash) : (on ? C.infoWash : "transparent");
              const bd = qr ? (right ? C.successEdge : C.dangerLine) : (on ? C.infoEdge : C.borderStrong);
              return (
                <button key={o.label+i} onClick={()=>{ if (!qr) toggleKept(i); }} disabled={qr}
                  style={{display:"flex",alignItems:"center",gap:"0.6rem",textAlign:"left",width:"100%",
                    background:bg,border:`1px solid ${bd}`,borderRadius:10,padding:"0.6rem 0.75rem",
                    cursor:qr?"default":"pointer",color:on?C.textStrong:C.textFaint,
                    fontSize:"0.9rem",fontWeight:600,
                    textDecoration:!on&&!qr?"line-through":"none"}}>
                  <span style={{fontSize:"1.05rem"}}>{on ? "☑" : "☐"}</span>
                  <span style={{flex:1}}>{o.label}</span>
                  {qr && !o.real && <span style={{fontSize:"0.7rem",fontWeight:800,color:C.dangerLite,whiteSpace:"nowrap"}}>IMPOSTOR</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* One button holds the bottom of the screen through both halves of a
            question, so it is also the most direct place to report the answer.
            Neutral until you have answered: the face was green there before,
            which made the loudest colour on the screen the one saying nothing —
            it was green whether the drink was about to go well or badly.
            Afterwards it takes the same green/red the other quiz grades itself
            with (✓ Knew It / ✗ Didn't Know, below), so "was I right" is
            answered by the control your thumb is already on rather than only by
            the line of text above the list. */}
        {qr
          ? <button onClick={next86} style={{...btn(gotIt ? C.successDeep : C.danger),width:"100%"}}>{qi+1 >= quizPool.length ? "See Results" : "Next →"}</button>
          : <button onClick={check86} style={{...btn(C.surfaceQuiet),width:"100%",border:`1px solid ${C.borderStrong}`}}>Check Answer</button>}
      </div></div>
    );
  }

  if (mode === "quiz") {
    const c = quizPool[qi];
    return (
      <div style={page}><div style={wrap}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <button onClick={()=>setMode("menu")} style={{background:"transparent",border:"none",color:C.textMuted,cursor:"pointer"}}>← Menu</button>
          <span style={{color:C.textMuted,fontSize:"0.85rem"}}>{qi+1} / {quizPool.length}</span>
          <span style={{color:C.success,fontWeight:700}}>{qa.filter(Boolean).length} ✓</span>
        </div>
        <div style={frame({borderRadius:99,height:6,marginBottom:"1.5rem",overflow:"hidden"})}>
          <div style={{background:C.accentAlt,height:"100%",width:`${(qi/quizPool.length)*100}%`,transition:"width 0.3s"}} />
        </div>
        <div style={frame({borderRadius:20,padding:"2rem",marginBottom:"1.25rem",minHeight:280,display:"flex",flexDirection:"column",justifyContent:"space-between"})}>
          <div>
            <h2 style={{fontSize:"1.5rem",fontWeight:800,color:C.textStrong,margin:0}}>{c.name}</h2>
            {c.rank && <div style={{fontSize:"0.7rem",color:C.accent,marginTop:"0.25rem",fontWeight:600}}>#{c.rank} DI 2026</div>}
          </div>
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem 0"}}>
            {!qr
              ? <button onClick={()=>setQr(true)} style={btn(C.surfaceQuiet,{color:C.textBody,fontSize:"0.95rem"})}>Reveal Ingredients</button>
              : <div style={{color:C.textBody,lineHeight:1.85,fontSize:"0.9rem"}}>
                  {c.glass && <div style={{padding:"0.1rem 0",borderBottom:`1px solid ${C.borderFaint}`,color:C.textMuted}}>{glassIcon(c.glass)} {c.glass} • {getMethod(c)}{c.serve ? " • " + c.serve : ""}</div>}
                  {c.ingredients.split(", ").map((g,i,a)=>(
                    <div key={i} style={{padding:"0.1rem 0",borderBottom:i<a.length-1?`1px solid ${C.borderFaint}`:"none"}}>{g}</div>
                  ))}
                </div>
            }
          </div>
        </div>
        {qr && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
            <button onClick={()=>qGrade(true)} style={btn(C.successDeep)}>✓ Knew It</button>
            <button onClick={()=>qGrade(false)} style={btn(C.danger)}>✗ Didn't Know</button>
          </div>
        )}
      </div></div>
    );
  }

  if (mode === "results") {
    const knew = qa.filter(Boolean).length;
    const pct = Math.round((knew/quizPool.length)*100);
    const missed = quizPool.filter((_,i)=>qa[i]===false);
    // Score color reuses the deck's own green/amber ramp (see `col`) so a good
    // quiz reads the same color as a mastered card.
    const pctColor = pct >= 90 ? C.success : pct >= 70 ? C.accent : C.dangerText;
    // Tested against the raw count, not `pct`: a 199/200 quiz rounds to 100% and
    // must not get the fireworks. Only a genuine clean sweep does.
    const perfect = quizPool.length > 0 && knew === quizPool.length;
    return (
      <div style={page}><div style={wrap}>
        {perfect && <Fireworks />}
        <div style={{textAlign:"center",marginBottom:"2rem"}}>
          <h2 style={{fontSize:"2rem",fontWeight:800,margin:"0 0 0.5rem",color:pctColor}}>{pct}%</h2>
          <p style={{color:C.textMuted}}>You knew {knew} out of {quizPool.length} cocktails</p>
        </div>
        {missed.length > 0 && (
          <div style={frame({borderRadius:16,padding:"1.25rem",marginBottom:"1.5rem",maxHeight:280,overflowY:"auto"})}>
            <h3 style={{fontWeight:700,marginTop:0,color:C.error,fontSize:"0.9rem",textTransform:"uppercase",letterSpacing:"0.05em"}}>Needs Work ({missed.length})</h3>
            <div style={{display:"flex",flexWrap:"wrap",gap:"0.4rem"}}>
              {missed.map(c=>(
                <span key={c.name} style={{background:C.dangerWash,border:`1px solid ${C.dangerEdge}`,color:C.dangerLite,borderRadius:6,padding:"0.2rem 0.5rem",fontSize:"0.8rem"}}>{c.name}</span>
              ))}
            </div>
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem"}}>
          {/* Retries reshuffle at the length you already picked — the common case
              is another round of the same size, not another trip to the picker. */}
          <button onClick={()=>startPicked(quizLen)} style={btn(quizKind === "86" ? C.danger : C.accentAlt)}>Retry Quiz</button>
          <button onClick={()=>setMode("menu")} style={btn(C.surfaceQuiet)}>Menu</button>
        </div>
        <button onClick={()=>setMode("quizlen")} style={{width:"100%",marginTop:"0.75rem",padding:"0.6rem",borderRadius:8,background:"transparent",color:C.textMuted,fontWeight:600,fontSize:"0.85rem",border:"none",cursor:"pointer",textDecoration:"underline"}}>Change quiz length</button>
      </div></div>
    );
  }
}

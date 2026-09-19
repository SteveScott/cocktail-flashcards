// Run with: npm test
//
// The Android launcher shortcuts are spelled out in five files and no compiler
// reads more than one of them:
//
//   android/app/src/main/res/xml/shortcuts.xml   the shortcuts themselves
//   .../java/com/bpp/cocktailflashcards/ShortcutRoutes.java   the ids, in Java
//   src/app-shortcuts.js                         the ids, in JavaScript
//   .../res/values/strings.xml                   the labels
//   .../AndroidManifest.xml                      which entry publishes the list
//
// Every disagreement between them fails silently. A URI shortcuts.xml sends and
// ShortcutRoutes does not recognise is a menu entry that opens the app on the
// menu; an id Java forwards and app-shortcuts.js does not list is dropped on the
// floor; a missing @string is a build error, but a missing meta-data is a colour
// scheme whose icon simply has no long-press menu. None of that shows up on a
// device unless you happen to be holding the one in the wrong state.
//
// So this reads the five files as text and compares them. Plain node, no runner,
// no dependency, same as the rest of tests/. Text rather than imports on purpose:
// src/app-shortcuts.js pulls in @capacitor/core, which expects a browser.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const ANDROID = "android/app/src/main";
const SHORTCUTS_XML = read(`${ANDROID}/res/xml/shortcuts.xml`);
const STRINGS_XML = read(`${ANDROID}/res/values/strings.xml`);
const MANIFEST = read(`${ANDROID}/AndroidManifest.xml`);
const ROUTES_JAVA = read(`${ANDROID}/java/com/bpp/cocktailflashcards/ShortcutRoutes.java`);
const BRIDGE_JS = read("src/app-shortcuts.js");

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── what each file thinks the shortcuts are ────────────────────────────────

// <shortcut android:shortcutId="..."> in declaration order, which is the order
// the launcher lists them in.
const xmlShortcuts = [...SHORTCUTS_XML.matchAll(
  /<shortcut\b[\s\S]*?<\/shortcut>/g
)].map((m) => {
  const block = m[0];
  const attr = (name) => block.match(new RegExp(`android:${name}="([^"]*)"`))?.[1] ?? null;
  return {
    id: attr("shortcutId"),
    data: attr("data"),
    icon: attr("icon"),
    shortLabel: attr("shortcutShortLabel"),
    longLabel: attr("shortcutLongLabel"),
    targetClass: attr("targetClass"),
    targetPackage: attr("targetPackage"),
  };
});

// private static final String[] IDS = { STUDY, SELF_QUIZ, EIGHTY_SIX };
// resolved through the constants above it.
const javaConstants = Object.fromEntries(
  [...ROUTES_JAVA.matchAll(/public static final String (\w+) = "([^"]+)";/g)].map((m) => [m[1], m[2]])
);
const javaIds = (ROUTES_JAVA.match(/String\[\] IDS = \{([^}]*)\}/)?.[1] ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((name) => javaConstants[name] ?? `<unresolved ${name}>`);

// export const SHORTCUTS = ["study", ...];
const jsIds = [...(BRIDGE_JS.match(/export const SHORTCUTS = \[([^\]]*)\]/)?.[1] ?? "")
  .matchAll(/"([^"]+)"/g)].map((m) => m[1]);

ok("shortcuts.xml declares some shortcuts", xmlShortcuts.length > 0);
eq("ShortcutRoutes.java lists the same ids, in the same order",
   javaIds, xmlShortcuts.map((s) => s.id));
eq("src/app-shortcuts.js lists the same ids, in the same order",
   jsIds, xmlShortcuts.map((s) => s.id));

// ── the URI each shortcut carries ──────────────────────────────────────────

// ShortcutRoutes builds SCHEME + "://" + HOST + "/" + id, and shortcuts.xml
// writes the answer out by hand. This is the comparison neither file can make.
const scheme = ROUTES_JAVA.match(/String SCHEME = "([^"]+)"/)?.[1];
const host = ROUTES_JAVA.match(/String HOST = "([^"]+)"/)?.[1];
ok("ShortcutRoutes names a scheme and a host", Boolean(scheme && host));

eq("every android:data is the URI ShortcutRoutes would build",
   xmlShortcuts.map((s) => s.data),
   xmlShortcuts.map((s) => `${scheme}://${host}/${s.id}`));

// The app's OAuth redirect scheme. If the two were ever the same string, a
// sign-in return would parse as a shortcut and throw the user out of the flow
// and into a quiz.
const authScheme = STRINGS_XML.match(/<string name="custom_url_scheme">([^<]*)<\/string>/)?.[1];
ok("the shortcut scheme is not the sign-in redirect scheme", scheme !== authScheme);

// ── what the shortcuts point at ────────────────────────────────────────────

// The aliases flip with the colour scheme (LauncherIconPlugin); the activity
// behind them does not. A shortcut aimed at an alias stops launching as soon as
// the user picks the other scheme.
const aliasNames = [...MANIFEST.matchAll(/<activity-alias[\s\S]*?android:name="\.(\w+)"/g)].map((m) => m[1]);
ok("the manifest still has launcher aliases to be wrong about", aliasNames.length > 0);

for (const s of xmlShortcuts) {
  eq(`${s.id} targets CocktailActivity`, s.targetClass, "com.bpp.cocktailflashcards.CocktailActivity");
  ok(`${s.id} does not target a flipped alias`,
     !aliasNames.some((a) => s.targetClass?.endsWith(`.${a}`)));
}

// res/xml is not processed for manifest placeholders, so ${applicationId} here
// would ship as those literal characters.
eq("no shortcut target carries an unsubstituted placeholder",
   xmlShortcuts.filter((s) => `${s.targetPackage}${s.targetClass}`.includes("${")).map((s) => s.id), []);

eq("every targetPackage is the applicationId",
   [...new Set(xmlShortcuts.map((s) => s.targetPackage))], ["com.bpp.cocktailflashcards"]);

// ── labels and icons ───────────────────────────────────────────────────────

const stringNames = new Set(
  [...STRINGS_XML.matchAll(/<string name="([^"]+)"/g)].map((m) => m[1])
);
const labelRefs = xmlShortcuts.flatMap((s) => [s.shortLabel, s.longLabel]);

eq("every label is a @string reference",
   labelRefs.filter((r) => !r?.startsWith("@string/")), []);
eq("and every one of them exists in strings.xml",
   labelRefs.filter((r) => !stringNames.has(r.replace("@string/", ""))), []);

// The launcher truncates a short label rather than wrapping it; Android's
// guidance is about ten characters.
for (const s of xmlShortcuts) {
  const text = STRINGS_XML.match(
    new RegExp(`<string name="${s.shortLabel.replace("@string/", "")}">([^<]*)</string>`)
  )?.[1];
  ok(`${s.id}'s short label fits the menu: ${text}`, text && text.length <= 12);
}

for (const s of xmlShortcuts) {
  const path = `${ANDROID}/res/drawable/${s.icon.replace("@drawable/", "")}.xml`;
  let icon = null;
  try { icon = read(path); } catch { /* reported below */ }
  ok(`${s.id} has an icon at ${path}`, icon !== null);
  // A shortcut icon is drawn by the launcher's process under the launcher's
  // theme, where the app's theme attributes do not exist.
  ok(`${s.id}'s icon carries no theme attribute`, icon !== null && !icon.includes('="?attr/'));
}

// ── who publishes the list ─────────────────────────────────────────────────

// Android reads android.app.shortcuts from the component holding the
// MAIN/LAUNCHER filter. Here that is whichever alias the colour scheme has
// enabled, so both of them need it or one scheme loses the menu.
const launcherBlocks = [...MANIFEST.matchAll(/<activity-alias[\s\S]*?<\/activity-alias>/g)]
  .map((m) => m[0])
  .filter((b) => b.includes("android.intent.category.LAUNCHER"));

eq("both launcher entries exist", launcherBlocks.length, 2);
eq("and both declare the shortcut list",
   launcherBlocks.filter((b) => /android:name="android\.app\.shortcuts"/.test(b)).length,
   launcherBlocks.length);
eq("pointing at the same resource",
   [...new Set([...MANIFEST.matchAll(
     /android:name="android\.app\.shortcuts"[\s\S]*?android:resource="([^"]+)"/g
   )].map((m) => m[1]))],
   ["@xml/shortcuts"]);

console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);

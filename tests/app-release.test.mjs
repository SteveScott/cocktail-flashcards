// Run with: npm test
//
// The APK's release number reaches the footer through a plugin name written in
// three files, and nothing in either build compares them:
//
//   .../java/com/bpp/cocktailflashcards/AppReleasePlugin.java   @CapacitorPlugin(name = ...)
//   .../java/com/bpp/cocktailflashcards/CocktailActivity.java   registerPlugin(...)
//   src/app-release.js                                          registerPlugin("...")
//
// Every disagreement between them fails the same silent way: the call rejects,
// src/app-release.js answers null, and the footer says "Android build unknown"
// — which is a sentence with a meaning. It says this binary predates the
// plugin, and a tester reading it back would be told to update an app that is
// already current. A typo here does not look like a bug; it looks like a
// diagnosis. So compare the three.
//
// Text rather than imports, like the rest of tests/: one side of this is Java,
// and the other pulls in @capacitor/core, which expects a browser.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const JAVA_DIR = "android/app/src/main/java/com/bpp/cocktailflashcards";
const PLUGIN_JAVA = read(`${JAVA_DIR}/AppReleasePlugin.java`);
const ACTIVITY_JAVA = read(`${JAVA_DIR}/CocktailActivity.java`);
const BRIDGE_JS = read("src/app-release.js");

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── the name, as each side spells it ───────────────────────────────────────

const javaName = PLUGIN_JAVA.match(/@CapacitorPlugin\(\s*name\s*=\s*"([^"]+)"/)?.[1] ?? null;
const jsName = BRIDGE_JS.match(/registerPlugin\(\s*"([^"]+)"\s*\)/)?.[1] ?? null;

ok("the Java plugin declares a name", javaName);
eq("and the JavaScript asks for that name", jsName, javaName);

// A plugin living in this project is not discovered — capacitor.plugins.json
// lists only the ones from npm — so the activity has to name the class, and
// without that line the bridge simply has no such plugin.
ok(
  "the activity registers AppReleasePlugin",
  /registerPlugin\(\s*AppReleasePlugin\.class\s*\)/.test(ACTIVITY_JAVA)
);

// ── the method behind it ───────────────────────────────────────────────────

const javaMethods = [...PLUGIN_JAVA.matchAll(
  /@PluginMethod\s+public\s+void\s+(\w+)\s*\(/g
)].map((m) => m[1]);
const jsCalls = [...BRIDGE_JS.matchAll(/AppRelease\.(\w+)\(/g)].map((m) => m[1]);

eq("the plugin exposes one method", javaMethods, ["get"]);
eq("and JavaScript calls only that one", [...new Set(jsCalls)], javaMethods);

// Both fields are read on the JS side, so both have to be put on the Java side.
for (const field of ["versionCode", "versionName"]) {
  ok(`Java returns ${field}`, PLUGIN_JAVA.includes(`result.put("${field}"`));
  ok(`JavaScript reads ${field}`, BRIDGE_JS.includes(`info.${field}`));
}

console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);

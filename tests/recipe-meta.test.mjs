import fs from "node:fs";
import { buildSteps, getMethod } from "../src/recipe-meta.js";

const data = JSON.parse(fs.readFileSync(new URL("../src/cocktails.json", import.meta.url), "utf8"));
const recipes = Object.values(data).flat().filter((x) => x && typeof x === "object" && x.name);
const recipe = recipes.find((x) => x.name === "Oaxacan Old Fashioned");

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};

eq("Oaxacan Old Fashioned keeps the Old Fashioned build", getMethod(recipe), "Built");
eq("Oaxacan Old Fashioned steps stay in the serving glass", buildSteps(recipe)[0], "Fill a rocks glass with fresh ice.");

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

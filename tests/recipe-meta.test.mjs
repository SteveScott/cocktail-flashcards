import cocktailData from "../src/cocktails.json" with { type: "json" };
import { getMethod } from "../src/recipe-meta.js";

let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
  else console.log(`ok   ${name}`);
};

const zombie = cocktailData.top50.find((c) => c.name === "Zombie");
eq("Zombie recipe exists", Boolean(zombie), true);
eq("Zombie uses chimney glass", zombie?.glass, "Chimney");
eq("Zombie keeps explicit flash-blend method", getMethod(zombie), "Flash Blend");
eq("chimney glass still counts as a built glass", getMethod({
  name: "Test Highball",
  glass: "Chimney",
  ingredients: "1 oz Gin, 4 oz Soda Water",
}), "Built");

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

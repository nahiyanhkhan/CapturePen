// Run: node tests/bake-exempt.test.js  (extracts isBakeExempt/partitionObjects from editor.js)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "editor.js"), "utf8");
const grab = (name) => {
  const s = src.indexOf("function " + name + "(");
  assert(s >= 0, name + " not found");
  return src.slice(s, src.indexOf("\n}\n", s) + 2);
};
const { isBakeExempt, partitionObjects } = new Function(grab("isSegmentObject") + grab("isBakeExempt") + grab("partitionObjects") + "return {isBakeExempt,partitionObjects};")();
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("ok   " + n); } catch (e) { fail++; console.log("FAIL " + n + "\n  " + e.message); } };
const L = { id: 1, type: "line" }, T = { id: 2, type: "text" }, R = { id: 3, type: "rect" }, E = { id: 4, type: "ellipse" };
t("line and text exempt", () => assert(isBakeExempt(L) && isBakeExempt(T)));
t("arrow exempt", () => assert(isBakeExempt({ id: 5, type: "arrow" })));
t("rect and ellipse not exempt", () => assert(!isBakeExempt(R) && !isBakeExempt(E)));
t("raster partition keeps line/text, bakes shapes, preserves order", () => {
  const p = partitionObjects([L, R, T, E], false);
  assert.deepStrictEqual(p.bake, [R, E]); assert.deepStrictEqual(p.keep, [L, T]);
});
t("bakeAll (crop) bakes everything", () => {
  const p = partitionObjects([L, R, T, E], true);
  assert.deepStrictEqual(p.bake, [L, R, T, E]); assert.deepStrictEqual(p.keep, []);
});
t("empty list", () => assert.deepStrictEqual(partitionObjects([], false), { bake: [], keep: [] }));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

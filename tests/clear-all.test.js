// Run: node tests/clear-all.test.js  (extracts isPristine from editor.js)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "editor.js"), "utf8");
const s0 = src.indexOf("function isPristine(");
assert(s0 >= 0, "isPristine not found");
const isPristine = new Function(src.slice(s0, src.indexOf("\n}\n", s0) + 2) + "return isPristine;")();
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("ok   " + n); } catch (e) { fail++; console.log("FAIL " + n + "\n  " + e.message); } };
const img = (w, h, v) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
t("same reference, no objects", () => { const a = img(2, 2, 5); assert(isPristine(a, a, [])); });
t("equal pixels, different reference", () => assert(isPristine(img(2, 2, 5), img(2, 2, 5), [])));
t("any object means not pristine", () => { const a = img(2, 2, 5); assert(!isPristine(a, a, [{ type: "line" }])); });
t("one changed pixel", () => { const b = img(2, 2, 5); b.data[7] = 6; assert(!isPristine(img(2, 2, 5), b, [])); });
t("different size (cropped)", () => assert(!isPristine(img(2, 2, 5), img(1, 2, 5), [])));
t("missing snapshots are not pristine", () => assert(!isPristine(null, img(1, 1, 0), [])));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

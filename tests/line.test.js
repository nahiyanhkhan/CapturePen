// Run: node tests/line.test.js  (extracts the pure line helpers and getObjectBounds from editor.js)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "editor.js"), "utf8");
const grab = (name) => {
  const s = src.indexOf("function " + name + "(");
  assert(s >= 0, name + " not found");
  const e = src.indexOf("\n}\n", s);
  return src.slice(s, e + 2);
};
const { distToSegment, snapAngle15, lineHitTolerance, translateLine, getObjectBounds } = new Function(
  grab("distToSegment") + grab("snapAngle15") + grab("lineHitTolerance") + grab("translateLine") + grab("getObjectBounds") +
  "return {distToSegment,snapAngle15,lineHitTolerance,translateLine,getObjectBounds};")();

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("ok   " + n); } catch (e) { fail++; console.log("FAIL " + n + "\n  " + e.message); } };
const near = (a, b, m) => assert(Math.abs(a - b) < 1e-9, (m || "") + " " + a + " vs " + b);
const A = { x: 0, y: 0 }, B = { x: 10, y: 0 };

t("dist: perpendicular to middle", () => near(distToSegment({ x: 5, y: 3 }, A, B), 3));
t("dist: clamps past B", () => near(distToSegment({ x: 13, y: 4 }, A, B), 5));
t("dist: clamps before A", () => near(distToSegment({ x: -3, y: 4 }, A, B), 5));
t("dist: on segment is 0", () => near(distToSegment({ x: 4, y: 0 }, A, B), 0));
t("dist: degenerate segment = point distance", () => near(distToSegment({ x: 3, y: 4 }, A, A), 5));

t("snap: 10 degrees -> 15", () => {
  const len = 100, a = 10 * Math.PI / 180;
  const r = snapAngle15(A, { x: len * Math.cos(a), y: len * Math.sin(a) });
  near(Math.atan2(r.y, r.x), 15 * Math.PI / 180);
  near(Math.hypot(r.x, r.y), len, "length");
});
t("snap: 7 degrees -> 0", () => {
  const a = 7 * Math.PI / 180, r = snapAngle15(A, { x: 50 * Math.cos(a), y: 50 * Math.sin(a) });
  near(r.x, 50); near(r.y, 0);
});
t("snap: relative to a, negative angle", () => {
  const r = snapAngle15({ x: 10, y: 10 }, { x: 10, y: 0 }); // straight up, -90
  near(r.x, 10); near(r.y, 0);
});
t("snap: near 180 degrees -> 180", () => { const r = snapAngle15(A, { x: -20, y: 1 }); near(r.x, -Math.hypot(20, 1)); near(r.y, 0); });
t("snap: zero length stays at a", () => { const r = snapAngle15({ x: 4, y: 5 }, { x: 4, y: 5 }); near(r.x, 4); near(r.y, 5); });

t("tolerance: size dominates", () => assert.strictEqual(lineHitTolerance(40, 1), 20));
t("tolerance: 6*scale floor", () => assert.strictEqual(lineHitTolerance(3, 2), 12));

t("translate: shifts both points", () =>
  assert.deepStrictEqual(translateLine({ x1: 1, y1: 2, x2: 4, y2: 6 }, 10, -1), { x1: 11, y1: 1, x2: 14, y2: 5 }));
t("translate: length and angle unchanged", () => {
  const o = { x1: 1, y1: 2, x2: 4, y2: 6 }, n = translateLine(o, 7.5, 3.25);
  near(Math.hypot(n.x2 - n.x1, n.y2 - n.y1), 5);
  near(n.x2 - n.x1, 3); near(n.y2 - n.y1, 4);
});
t("translate: does not mutate input", () => { const o = { x1: 1, y1: 2, x2: 3, y2: 4 }; translateLine(o, 5, 5); assert.strictEqual(o.x1, 1); });

t("bounds: padded by size/2, order independent", () =>
  assert.deepStrictEqual(getObjectBounds({ type: "line", x1: 10, y1: 20, x2: 4, y2: 30, size: 4 }), { x: 2, y: 18, w: 10, h: 14 }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Run: node tests/line-drag.test.js  (composes the real helpers the way the pointermove endpoint/move branches do)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "editor.js"), "utf8");
const grab = (n) => { const s = src.indexOf("function " + n + "("); assert(s >= 0, n); return src.slice(s, src.indexOf("\n}\n", s) + 2); };
const { distToSegment, snapAngle15, translateLine } = new Function(
  grab("distToSegment") + grab("snapAngle15") + grab("translateLine") + "return {distToSegment,snapAngle15,translateLine};")();
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("ok   " + n); } catch (e) { fail++; console.log("FAIL " + n + "\n  " + e.message); } };
const near = (a, b, m) => assert(Math.abs(a - b) < 1e-9, (m || "") + " " + a + " vs " + b);
// Mirror of the select/endpoint branch (editor.js pointermove).
const drag = (orig, handle, pos, shift) => {
  const o = { ...orig }, a = handle === "a";
  const fixed = a ? { x: orig.x2, y: orig.y2 } : { x: orig.x1, y: orig.y1 };
  const p = shift ? snapAngle15(fixed, pos) : pos;
  if (a) { o.x1 = p.x; o.y1 = p.y; } else { o.x2 = p.x; o.y2 = p.y; }
  return o;
};
const L = { x1: 10, y1: 20, x2: 110, y2: 70 };
t("endpoint B drag: A exactly fixed over 360 degrees incl. crossing A", () => {
  for (let d = 0; d < 360; d += 7) { const r = d * Math.PI / 180;
    const o = drag(L, "b", { x: 10 + 80 * Math.cos(r), y: 20 + 80 * Math.sin(r) }); assert.strictEqual(o.x1, 10); assert.strictEqual(o.y1, 20); }
});
t("endpoint A drag: B exactly fixed", () => {
  for (let d = 0; d < 360; d += 7) { const r = d * Math.PI / 180;
    const o = drag(L, "a", { x: 110 + 30 * Math.cos(r), y: 70 + 30 * Math.sin(r) }, d % 2); assert.strictEqual(o.x2, 110); assert.strictEqual(o.y2, 70); }
});
t("endpoint shift: angle about the fixed end is a multiple of 15 deg, length kept", () => {
  const o = drag(L, "b", { x: 50, y: 33 }, true);
  const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1) * 180 / Math.PI;
  near(ang / 15, Math.round(ang / 15)); near(Math.hypot(o.x2 - o.x1, o.y2 - o.y1), Math.hypot(40, 13));
});
t("endpoint drag may leave the canvas (no clamp)", () => { const o = drag(L, "b", { x: -500, y: 9000 }); near(o.x2, -500); near(o.y2, 9000); });
t("move uses original, not accumulated: repeated deltas do not drift", () => {
  let o; for (const d of [5, 50, -3, 0]) o = translateLine(L, d, 2 * d);
  assert.deepStrictEqual(o, L);
});
t("move preserves length and angle", () => {
  const o = translateLine(L, 37.3, -91.1);
  near(Math.hypot(o.x2 - o.x1, o.y2 - o.y1), Math.hypot(100, 50)); near(Math.atan2(o.y2 - o.y1, o.x2 - o.x1), Math.atan2(50, 100));
});
t("hit-test geometry: point on body within size/2 hits, far point misses", () => {
  near(distToSegment({ x: 60, y: 45 }, { x: 10, y: 20 }, { x: 110, y: 70 }), 0);
  assert(distToSegment({ x: 60, y: 80 }, { x: 10, y: 20 }, { x: 110, y: 70 }) > 20);
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

// Run: node tests/arrow.test.js  (extracts the arrow helpers and getObjectBounds from editor.js)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "editor.js"), "utf8");
const grab = (name) => {
  const s = src.indexOf("function " + name + "(");
  assert(s >= 0, name + " not found");
  return src.slice(s, src.indexOf("\n}\n", s) + 2);
};
const { isSegmentObject, arrowGeometry, pointInTriangle, getObjectBounds, distToSegment, lineHitTolerance } = new Function(
  ["isSegmentObject", "arrowGeometry", "pointInTriangle", "distToSegment", "lineHitTolerance", "getObjectBounds"].map(grab).join("") +
  "return {isSegmentObject,arrowGeometry,pointInTriangle,getObjectBounds,distToSegment,lineHitTolerance};")();

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("ok   " + n); } catch (e) { fail++; console.log("FAIL " + n + "\n  " + e.message); } };
const near = (a, b, m) => assert(Math.abs(a - b) < 1e-9, (m || "") + " " + a + " vs " + b);

t("isSegmentObject: line and arrow only", () => {
  assert(isSegmentObject({ type: "line" }) && isSegmentObject({ type: "arrow" }));
  assert(!isSegmentObject({ type: "rect" }) && !isSegmentObject({ type: "text" }));
});

t("geometry: angle 0 head", () => {
  const g = arrowGeometry(0, 0, 100, 0, 3); // headLen 20
  near(g.headLen, 20); near(g.angle, 0);
  near(g.shaftEnd.x, 88); near(g.shaftEnd.y, 0);
  assert.deepStrictEqual(g.head[0], { x: 100, y: 0 });
  near(g.head[1].x, 100 - 20 * Math.cos(-Math.PI / 6)); near(g.head[1].y, 10);
  near(g.head[2].y, -10);
});
t("geometry: 90 degrees (down)", () => {
  const g = arrowGeometry(0, 0, 0, 100, 3);
  near(g.shaftEnd.x, 0); near(g.shaftEnd.y, 88);
  near(g.head[1].y, 100 - 20 * Math.sin(Math.PI / 2 - Math.PI / 6)); near(Math.abs(g.head[1].x), 10);
});
t("geometry: 180 and 270 degrees", () => {
  near(arrowGeometry(100, 0, 0, 0, 3).shaftEnd.x, 12);
  near(arrowGeometry(0, 100, 0, 0, 3).shaftEnd.y, 12);
});
t("geometry: headLen min 20, scales with size", () => {
  near(arrowGeometry(0, 0, 100, 0, 1).headLen, 20);
  near(arrowGeometry(0, 0, 100, 0, 10).headLen, 32);
});
t("geometry: head symmetric about the axis, all points headLen from tip", () => {
  const g = arrowGeometry(5, 5, 60, 40, 8);
  [g.head[1], g.head[2]].forEach((p) => near(Math.hypot(p.x - 60, p.y - 40), g.headLen));
});
t("geometry: short arrow has no shaft, head still full size", () => {
  const g = arrowGeometry(0, 0, 5, 0, 3);
  assert.strictEqual(g.hasShaft, false); near(g.headLen, 20);
  assert.strictEqual(arrowGeometry(0, 0, 12, 0, 3).hasShaft, true); // exactly the pull-back
});
t("geometry: zero length -> angle 0, head only", () => {
  const g = arrowGeometry(7, 7, 7, 7, 3);
  near(g.angle, 0); assert.strictEqual(g.hasShaft, false);
});

const A = { x: 0, y: 0 }, B = { x: 10, y: 0 }, C = { x: 0, y: 10 };
t("triangle: inside", () => assert(pointInTriangle({ x: 2, y: 2 }, A, B, C)));
t("triangle: outside", () => assert(!pointInTriangle({ x: 8, y: 8 }, A, B, C)));
t("triangle: on edge counts", () => assert(pointInTriangle({ x: 5, y: 0 }, A, B, C)));
t("triangle: winding independent", () => assert(pointInTriangle({ x: 2, y: 2 }, A, C, B)));

t("bounds: contain A, tip, head points, padded by size/2", () => {
  const o = { type: "arrow", x1: 0, y1: 0, x2: 100, y2: 0, size: 4 };
  const b = getObjectBounds(o), g = arrowGeometry(0, 0, 100, 0, 4);
  [{ x: 0, y: 0 }, ...g.head].forEach((p) => assert(p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h, JSON.stringify(p)));
  near(b.x, -2); near(b.w, 104); near(b.h, 2 * (g.headLen * 0.5) + 4);
});
t("bounds: short arrow includes head beyond A-B box", () => {
  const b = getObjectBounds({ type: "arrow", x1: 0, y1: 0, x2: 5, y2: 0, size: 3 });
  assert(b.x < -10 && b.h > 15);
});

t("hit: head triangle hit where the shaft band misses; miss outside", () => {
  const o = { type: "arrow", x1: 0, y1: 0, x2: 100, y2: 0, size: 3 }, h = arrowGeometry(0, 0, 100, 0, 3).head;
  const tol = lineHitTolerance(3, 1), p = { x: 84, y: 8 };
  assert(distToSegment(p, { x: 0, y: 0 }, { x: 100, y: 0 }) > tol);
  assert(pointInTriangle(p, h[0], h[1], h[2]));
  assert(distToSegment({ x: 50, y: 4 }, A, { x: 100, y: 0 }) <= tol); // shaft
  const miss = { x: 50, y: 30 };
  assert(distToSegment(miss, A, { x: 100, y: 0 }) > tol && !pointInTriangle(miss, h[0], h[1], h[2]));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

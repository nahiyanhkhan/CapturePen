// Run: node tests/text-wrap.test.js  (extracts wrapText/getObjectBounds from editor.js)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "editor.js"), "utf8");
const grab = (name) => {
  const s = src.indexOf("function " + name + "(");
  assert(s >= 0, name + " not found");
  const e = src.indexOf("\n}\n", s);
  return src.slice(s, e + 2);
};
const K = 10; // px per char
const ctx = { font: "", measureText: (t) => ({ width: t.length * K }) };
const { wrapText, getObjectBounds, scaleTextBox } = new Function("ctx",
  grab("textFont") + grab("wrapText") + grab("scaleTextBox") + grab("getObjectBounds") + "return {wrapText,getObjectBounds,scaleTextBox};")(ctx);

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("ok   " + n); } catch (e) { fail++; console.log("FAIL " + n + "\n  " + e.message); } };
const eq = assert.deepStrictEqual;

t("no maxW splits only on \\n", () => eq(wrapText(ctx, "aaa bbb ccc\ndd", undefined), ["aaa bbb ccc", "dd"]));
t("maxW=0 treated as no wrap", () => eq(wrapText(ctx, "aaa bbb", 0), ["aaa bbb"]));
t("fits within maxW stays one line", () => eq(wrapText(ctx, "aaa bbb", 70), ["aaa bbb"]));
t("word wrap at spaces", () => eq(wrapText(ctx, "aaa bbb ccc", 80), ["aaa bbb ", "ccc"]));
t("wrapped lines (trailing space) never exceed maxW except trailing space", () => {
  wrapText(ctx, "aa bb cc dd ee ff", 60).forEach((l) => assert(l.trimEnd().length * K <= 60, l));
});
t("overlong word is char-broken", () => eq(wrapText(ctx, "abcdefghij", 40), ["abcd", "efgh", "ij"]));
t("overlong word after short word", () => eq(wrapText(ctx, "ab cdefghij", 40), ["ab ", "cdef", "ghij"]));
t("empty lines preserved (no wrap)", () => eq(wrapText(ctx, "a\n\nb", undefined), ["a", "", "b"]));
t("empty lines preserved (wrap)", () => eq(wrapText(ctx, "a\n\nb", 50), ["a", "", "b"]));
t("wrap + newline combined", () => eq(wrapText(ctx, "aaa bbb\nc", 40), ["aaa ", "bbb", "c"]));
t("no characters lost", () => eq(wrapText(ctx, "hello brave new world", 70).join(""), "hello brave new world"));
t("trailing space hangs: aaa bbb ccc at 70", () => eq(wrapText(ctx, "aaa bbb ccc", 70), ["aaa bbb ", "ccc"]));
t("no leading-space line: 'abc d' at 30", () => eq(wrapText(ctx, "abc d", 30), ["abc ", "d"]));
t("no blank line: 'ab    cd' at 30", () => {
  const r = wrapText(ctx, "ab    cd", 30);
  assert(r.every((l) => l.trim()), JSON.stringify(r));
  eq(r.join(""), "ab    cd");
});

t("broken long word: trailing space hangs, no leading-space line", () => eq(wrapText(ctx, "abcdefgh x", 40), ["abcd", "efgh ", "x"]));

// scaleTextBox(origW, origH, k, x, y, canvasW, canvasH, fontSize)
t("scale: proportional", () => eq(scaleTextBox(100, 50, 2, 0, 0, 1000, 1000, 10), { w: 200, h: 100 }));
t("scale: capped to canvas", () => eq(scaleTextBox(100, 50, 2, 900, 950, 1000, 1000, 10), { w: 100, h: 50 }));
t("scale: w floored at 2*fontSize", () => assert.strictEqual(scaleTextBox(100, 50, 0.01, 0, 0, 1000, 1000, 10).w, 20));
t("scale: h floored at one line", () => assert.strictEqual(scaleTextBox(100, 50, 0.01, 0, 0, 1000, 1000, 10).h, 12));
t("scale: no negative w when x beyond canvas", () => assert(scaleTextBox(100, 50, 1, 1200, 0, 1000, 1000, 10).w >= 20));
t("scale: no h when origH missing", () => eq(scaleTextBox(100, undefined, 2, 0, 0, 1000, 1000, 10), { w: 200 }));

const base = { type: "text", x: 5, y: 7, fontSize: 10, text: "aaa bbb ccc" }; // lh=12
t("bounds legacy (no w): width=longest line, h=lines*1.2*fs", () =>
  eq(getObjectBounds({ ...base, text: "aaaaa\nbb" }), { x: 5, y: 7, w: 50, h: 24 }));
t("bounds with w only: w=obj.w, h=wrapped height", () =>
  eq(getObjectBounds({ ...base, w: 80 }), { x: 5, y: 7, w: 80, h: 24 }));
t("bounds with w,h larger than text: h=obj.h", () =>
  eq(getObjectBounds({ ...base, w: 80, h: 100 }), { x: 5, y: 7, w: 80, h: 100 }));
t("bounds with w,h smaller than text: h grows to wrapped height", () =>
  eq(getObjectBounds({ ...base, w: 80, h: 5 }), { x: 5, y: 7, w: 80, h: 24 }));
t("bounds sets font on ctx", () => assert(/10px/.test(ctx.font)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

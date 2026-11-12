// Run: node tests/text-box.test.js  (extracts clampTextBox/commitActiveText from editor.js, with stubs)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "editor.js"), "utf8");
const grab = (name) => {
  const s = src.indexOf("function " + name + "(");
  assert(s >= 0, name + " not found");
  return src.slice(s, src.indexOf("\n}\n", s) + 2);
};
// Fresh sandbox per test: stubs + the real functions, state exposed through accessors.
function make(canvasW = 1000, canvasH = 600) {
  const env = { pushes: 0, renders: 0 };
  const canvas = { width: canvasW, height: canvasH };
  const textInput = { value: "", blurs: 0, blur() { this.blurs++; } };
  const textOverlay = { style: { display: "block" } };
  const body = grab("clampTextBox") + grab("cancelActiveText") + grab("commitActiveText") + `
    return { clampTextBox, cancelActiveText, commitActiveText,
      st: { get objects() { return objects; }, set objects(v) { objects = v; }, get activeText() { return activeText; },
        set activeText(v) { activeText = v; }, get editingId() { return editingId; }, set editingId(v) { editingId = v; },
        get selectedId() { return selectedId; }, set selectedId(v) { selectedId = v; }, get nextObjId() { return nextObjId; } } };`;
  const api = new Function("canvas", "textInput", "textOverlay", "render", "pushHistory",
    "let objects = [], activeText = null, editingId = null, selectedId = 5, nextObjId = 1;" + body)(
    canvas, textInput, textOverlay, () => env.renders++, () => env.pushes++);
  return Object.assign(env, api, { canvas, textInput, textOverlay });
}

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("ok   " + n); } catch (e) { fail++; console.log("FAIL " + n + "\n  " + e.message); } };
const eq = assert.deepStrictEqual;
const box = (o) => Object.assign({ x: 10, y: 10, w: 200, h: 30, fontSize: 20, color: "#f00" }, o);

// ---- clampTextBox ----
t("clamp: in-bounds box unchanged", () => { const e = make(), b = box(); e.clampTextBox(b); eq([b.x, b.y, b.w, b.h], [10, 10, 200, 30]); });
t("clamp: negative x/y pulled to 0", () => { const e = make(), b = box({ x: -50, y: -5 }); e.clampTextBox(b); eq([b.x, b.y], [0, 0]); });
t("clamp: box overflowing right/bottom is shifted in", () => { const e = make(), b = box({ x: 950, y: 590 }); e.clampTextBox(b); eq([b.x, b.y], [800, 570]); });
t("clamp: w/h larger than canvas capped, origin 0", () => { const e = make(), b = box({ w: 5000, h: 5000, x: 300, y: 300 }); e.clampTextBox(b); eq([b.x, b.y, b.w, b.h], [0, 0, 1000, 600]); });
t("clamp: min width is 2*fontSize, min height 1.2*fontSize", () => { const e = make(), b = box({ w: 1, h: 1 }); e.clampTextBox(b); eq([b.w, b.h], [40, 24]); });
t("clamp: tiny canvas smaller than min size -> box = canvas, x/y 0", () => { const e = make(30, 10), b = box({ x: 5, y: 5 }); e.clampTextBox(b); eq([b.x, b.y, b.w, b.h], [0, 0, 30, 10]); });
t("clamp: larger font after slider re-grows min width", () => { const e = make(), b = box({ w: 40, fontSize: 60, x: 990 }); e.clampTextBox(b); eq([b.w, b.x], [120, 880]); });
t("clamp: idempotent", () => { const e = make(), b = box({ x: -9, w: 3000 }); e.clampTextBox(b); const c = { ...b }; e.clampTextBox(b); eq(b, c); });

// ---- commitActiveText ----
const open = (e, value, extra) => {
  e.textInput.value = value;
  e.st.activeText = box(Object.assign({ editId: null }, extra));
  e.st.activeText.start = { text: extra && extra.startText, x: 10, y: 10, w: 200, h: 30, fontSize: 20, color: "#f00" };
};
const addObj = (e, text) => { e.st.objects = [{ id: 7, type: "text", x: 10, y: 10, w: 200, h: 30, text, color: "#f00", fontSize: 20 }]; };

t("commit with no active box is a no-op", () => { const e = make(); e.commitActiveText(); eq([e.pushes, e.renders], [0, 0]); });
t("commit: empty new box discarded, no push, overlay hidden, state cleared", () => {
  const e = make(); open(e, ""); e.commitActiveText();
  eq(e.st.objects.length, 0); eq(e.pushes, 0); eq(e.st.activeText, null); eq(e.textOverlay.style.display, "none"); eq(e.st.editingId, null);
});
t("commit: whitespace-only new box discarded", () => { const e = make(); open(e, "  \n \t"); e.commitActiveText(); eq([e.st.objects.length, e.pushes], [0, 0]); });
t("commit: non-empty new box creates one object and exactly one push", () => {
  const e = make(); open(e, "hello  \n\n"); e.commitActiveText();
  eq(e.st.objects.length, 1); eq(e.pushes, 1);
  const o = e.st.objects[0]; eq([o.type, o.text, o.x, o.y, o.w, o.h, o.fontSize, o.color], ["text", "hello", 10, 10, 200, 30, 20, "#f00"]);
  eq(e.st.selectedId, null); eq(e.st.nextObjId, 2);
});
t("commit: preserves leading spaces and inner newlines", () => { const e = make(); open(e, "  a\nb"); e.commitActiveText(); eq(e.st.objects[0].text, "  a\nb"); });
t("commit: second call is a no-op (no double push)", () => { const e = make(); open(e, "x"); e.commitActiveText(); e.commitActiveText(); eq([e.st.objects.length, e.pushes], [1, 1]); });
t("commit: unchanged re-edit pushes nothing", () => {
  const e = make(); addObj(e, "hi"); open(e, "hi", { editId: 7, startText: "hi" }); e.st.editingId = 7;
  e.commitActiveText(); eq(e.pushes, 0); eq(e.st.objects[0].text, "hi"); eq(e.st.editingId, null);
});
t("commit: unchanged re-edit with trailing whitespace typed still pushes nothing", () => {
  const e = make(); addObj(e, "hi"); open(e, "hi  \n", { editId: 7, startText: "hi" }); e.commitActiveText(); eq(e.pushes, 0);
});
t("commit: edited text updates object in place with exactly one push", () => {
  const e = make(); addObj(e, "hi"); open(e, "hello", { editId: 7, startText: "hi" }); e.commitActiveText();
  eq(e.pushes, 1); eq(e.st.objects.length, 1); eq(e.st.objects[0].text, "hello"); eq(e.st.objects[0].id, 7);
});
for (const [k, v] of [["x", 50], ["y", 50], ["w", 300], ["h", 99], ["fontSize", 30], ["color", "#0f0"]]) {
  t(`commit: re-edit changing only ${k} pushes once`, () => {
    const e = make(); addObj(e, "hi"); open(e, "hi", { editId: 7, startText: "hi", [k]: v }); e.commitActiveText();
    eq(e.pushes, 1); eq(e.st.objects[0][k], v);
  });
}
t("commit: existing text emptied is deleted with exactly one push", () => {
  const e = make(); addObj(e, "hi"); open(e, "   ", { editId: 7, startText: "hi" }); e.commitActiveText();
  eq(e.st.objects.length, 0); eq(e.pushes, 1);
});
t("commit: re-edit of object that no longer exists pushes nothing, no throw", () => {
  const e = make(); open(e, "x", { editId: 99, startText: "x" }); e.commitActiveText(); eq([e.pushes, e.st.activeText], [0, null]);
});
t("commit: render happens before push (history captures drawn state)", () => {
  const e = make(); const order = [];
  const api = new Function("canvas", "textInput", "textOverlay", "render", "pushHistory",
    "let objects=[],activeText={x:0,y:0,w:9,h:9,fontSize:5,color:'#000',editId:null},editingId=null,selectedId=null,nextObjId=1;" + grab("commitActiveText") + "return commitActiveText;")(
    e.canvas, { value: "a", blur() {} }, { style: {} }, () => order.push("render"), () => order.push("push"));
  api(); eq(order, ["render", "push"]);
});

// ---- cancelActiveText ----
t("cancel with no active box is a no-op", () => { const e = make(); e.cancelActiveText(); eq([e.pushes, e.renders], [0, 0]); });
t("cancel: new box discarded, no push, no object, overlay hidden, blurred", () => {
  const e = make(); open(e, "typed"); e.cancelActiveText();
  eq([e.st.objects.length, e.pushes, e.st.activeText, e.st.editingId, e.textOverlay.style.display, e.textInput.blurs], [0, 0, null, null, "none", 1]);
});
t("cancel: re-edit leaves original object unchanged and visible, no push", () => {
  const e = make(); addObj(e, "hi"); open(e, "changed", { editId: 7, startText: "hi", x: 90, fontSize: 33 }); e.st.editingId = 7;
  const before = JSON.stringify(e.st.objects); e.cancelActiveText();
  eq(JSON.stringify(e.st.objects), before); eq(e.st.editingId, null); eq(e.pushes, 0); assert(e.renders >= 1);
});
t("cancel: second call after cancel is a no-op", () => { const e = make(); open(e, "x"); e.cancelActiveText(); const r = e.renders; e.cancelActiveText(); eq(e.renders, r); });
t("commit blurs the textarea", () => { const e = make(); open(e, "x"); e.commitActiveText(); eq(e.textInput.blurs, 1); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// editor.js — CapturePen canvas editor

const canvas = document.getElementById("mainCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const wrap = document.getElementById("canvasWrap");
const toolBtns = document.querySelectorAll(".tool-btn");
const cropActions = document.getElementById("cropActions");
const sizeRange = document.getElementById("sizeRange");
const colorGroup = document.getElementById("colorGroup");
const textOverlay = document.getElementById("textInputOverlay");
const textInput = document.getElementById("textInput");
const toast = document.getElementById("toast");
const emptyState = document.getElementById("emptyState");
const fileInput = document.getElementById("fileInput");

let currentTool = "rect";
let currentColor = "#ff3b30";
let currentSize = 3;
// Font Size is controlled independently of Stroke Size below — Stroke Size
// only affects brush width and shape outlines; Font Size controls new text.
// Once placed, text can still be resized individually via its corner handles.
let currentFontSize = 16; // screen px

let history = []; // each entry: { base: dataURL, objects: [...], selectedId }
let historyIndex = -1;
const MAX_HISTORY = 40;

let isDragging = false;
let dragStart = null;
let snapshotBeforeDrag = null;
let cropRect = null; // {x,y,w,h} in canvas px, while crop tool active

// ---------- Editable objects (rect, ellipse, text) ----------
// These stay live — selectable, movable, resizable — instead of being baked
// into pixels the instant they're drawn. They only get flattened into
// `baseSnapshot` when a raster tool (brush/blur/crop) needs to touch
// actual pixels, since that can't be undone by moving a vector object.

let objects = [];
let selectedId = null;
let nextObjId = 1;
let baseSnapshot = null; // ImageData: the flat raster state, without live objects
let initialBase = null; // ImageData: the screenshot as first loaded (after the area-select crop); history[0] can be shifted out, so keep it apart

let dragMode = null; // 'create' | 'move' | 'resize' | 'endpoint'
let dragObj = null;
let dragHandle = null; // 'nw' | 'ne' | 'sw' | 'se' (resize) | 'a' | 'b' (line endpoint)
let dragOffset = null;
let dragOrigBounds = null;
let dragLineOrig = null; // {x1,y1,x2,y2} of a line at the start of a move/endpoint drag (kept off the object so history stays clean)

// Text box being edited in the overlay (canvas px), or null. See "Text tool" below.
let activeText = null;
let rasterPending = false; // brush/blur pointer is down but nothing drawn yet
let editingId = null; // id of the existing text object hidden from render() while it is re-edited

// ---------- Init ----------

// Run after the whole script has loaded, so init can use anything declared below.
queueMicrotask(async function init() {
  // Opened from "Edit screenshot from clipboard": load the clipboard image,
  // or wait for a paste/drop/open if there isn't one.
  const params = new URLSearchParams(location.search);
  // Opened from "Edit image from file": start empty for Choose a file / drop / paste.
  if (params.has("empty")) {
    showEmptyState(true);
    return;
  }
  if (params.has("blank")) {
    const src = await readClipboardImage();
    if (src) loadImage(src);
    else {
      showEmptyState(true);
      showToast("No image on the clipboard. Press Cmd+Ctrl+Shift+3 or 4, then Cmd+V here.");
    }
    return;
  }
  const data = await chrome.storage.session.get(["capturepen_image", "capturepen_crop", "capturepen_dpr"]);
  if (!data.capturepen_image) {
    showEmptyState(true);
    return;
  }
  loadImage(data.capturepen_image, data.capturepen_crop, data.capturepen_dpr);
});

// Image on the clipboard as a data URL, or null. Uses the clipboardRead permission.
async function readClipboardImage() {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    }
  } catch (e) {
    console.warn("CapturePen clipboard read failed:", e);
  }
  return null;
}

// Draw src (optionally cropped, in CSS px * dpr) as a new screenshot.
// The first load starts history; a later one (paste/drop/open) is an undoable step.
function loadImage(src, crop, dpr) {
  const img = new Image();
  img.onload = () => {
    let sx = 0, sy = 0, sw = img.width, sh = img.height;

    if (crop) {
      const d = dpr || 1;
      sx = Math.round(crop.x * d);
      sy = Math.round(crop.y * d);
      sw = Math.round(crop.width * d);
      sh = Math.round(crop.height * d);
    }

    cancelActiveText();
    objects = [];
    selectedId = null;
    canvas.width = sw;
    canvas.height = sh;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    snapshotBase();
    initialBase = baseSnapshot;
    showEmptyState(false);
    fitCanvasToView();
    render();
    pushHistory();
  };
  img.onerror = () => showToast("That file isn't an image CapturePen can open");
  img.src = src;
}

// ---------- Paste, drop or open an image ----------

function showEmptyState(on) {
  emptyState.style.display = on ? "" : "none";
  canvas.style.display = on ? "none" : "";
  document.getElementById("copyBtn").disabled = on;
  document.getElementById("downloadBtn").disabled = on;
  document.getElementById("clearBtn").disabled = on;
}

function loadImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("That isn't an image");
    return;
  }
  if (isDragging) return;
  const reader = new FileReader();
  reader.onload = () => {
    const hadImage = !!initialBase;
    loadImage(reader.result);
    if (hadImage) showToast("Image replaced — Ctrl/Cmd+Z to go back");
  };
  reader.readAsDataURL(file);
}

document.addEventListener("paste", (e) => {
  if (document.activeElement === textInput) return; // pasting text into a text box
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (!item) {
    if (!initialBase) showToast("No image on the clipboard. Copy a screenshot first.");
    return;
  }
  e.preventDefault();
  loadImageFile(item.getAsFile());
});

document.getElementById("openBtn").addEventListener("click", () => fileInput.click());
document.getElementById("emptyOpenBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  loadImageFile(fileInput.files[0]);
  fileInput.value = ""; // allow opening the same file again
});

wrap.addEventListener("dragover", (e) => {
  if (![...e.dataTransfer.types].includes("Files")) return;
  e.preventDefault();
  wrap.classList.add("dropping");
});
wrap.addEventListener("dragleave", (e) => {
  if (!wrap.contains(e.relatedTarget)) wrap.classList.remove("dropping");
});
wrap.addEventListener("drop", (e) => {
  e.preventDefault();
  wrap.classList.remove("dropping");
  loadImageFile(e.dataTransfer.files[0]);
});

function fitCanvasToView() {
  const maxW = wrap.clientWidth - 60;
  const maxH = wrap.clientHeight - 60;
  const scale = Math.min(1, maxW / canvas.width, maxH / canvas.height);
  canvas.style.width = canvas.width * scale + "px";
  canvas.style.height = canvas.height * scale + "px";
  if (activeText) { clampTextBox(activeText); syncTextOverlay(); autoGrowText(); }
}
window.addEventListener("resize", fitCanvasToView);

// Ratio between canvas internal resolution and its on-screen CSS size.
// Needed to keep hit-testing, handle sizes, and text sizing consistent
// with what's actually visible, regardless of zoom/fit scaling.
function getDisplayScale() {
  const rect = canvas.getBoundingClientRect();
  return rect.width ? canvas.width / rect.width : 1;
}

// ---------- Object model: render, hit-test, bake ----------

function snapshotBase() {
  baseSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function render() {
  if (baseSnapshot) ctx.putImageData(baseSnapshot, 0, 0);
  objects.forEach((obj) => { if (obj.id !== editingId) drawObject(ctx, obj); });
  const sel = objects.find((o) => o.id === selectedId);
  if (sel) drawHandles(sel);
}

function drawObject(targetCtx, obj) {
  targetCtx.save();
  targetCtx.strokeStyle = obj.color;
  targetCtx.fillStyle = obj.color;
  targetCtx.lineWidth = obj.size;
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";

  if (obj.type === "rect") {
    targetCtx.strokeRect(obj.x, obj.y, obj.w, obj.h);
  } else if (obj.type === "ellipse") {
    targetCtx.beginPath();
    targetCtx.ellipse(obj.x + obj.w / 2, obj.y + obj.h / 2, Math.abs(obj.w) / 2, Math.abs(obj.h) / 2, 0, 0, Math.PI * 2);
    targetCtx.stroke();
  } else if (obj.type === "arrow") {
    const g = arrowGeometry(obj.x1, obj.y1, obj.x2, obj.y2, obj.size);
    if (g.hasShaft) {
      targetCtx.beginPath();
      targetCtx.moveTo(obj.x1, obj.y1);
      targetCtx.lineTo(g.shaftEnd.x, g.shaftEnd.y);
      targetCtx.stroke();
    }
    targetCtx.beginPath();
    targetCtx.moveTo(g.head[0].x, g.head[0].y);
    targetCtx.lineTo(g.head[1].x, g.head[1].y);
    targetCtx.lineTo(g.head[2].x, g.head[2].y);
    targetCtx.closePath();
    targetCtx.fill();
  } else if (obj.type === "line") {
    targetCtx.beginPath();
    targetCtx.moveTo(obj.x1, obj.y1);
    targetCtx.lineTo(obj.x2, obj.y2);
    targetCtx.stroke();
  } else if (obj.type === "text") {
    targetCtx.font = textFont(obj.fontSize);
    targetCtx.textBaseline = "top";
    wrapText(targetCtx, obj.text, obj.w).forEach((line, i) => {
      targetCtx.fillText(line, obj.x, obj.y + i * obj.fontSize * 1.2);
    });
  }
  targetCtx.restore();
}

// Single source of truth for the text font (canvas and the editing textarea).
function textFont(size) {
  return `500 ${size}px -apple-system, sans-serif`;
}

// Split text into lines: on "\n", then greedy word wrap to maxW (canvas px).
// Words longer than maxW break by character. No maxW -> no wrapping (legacy).
// Caller must set the context font first.
function wrapText(c, text, maxW) {
  const out = [];
  text.split("\n").forEach((para) => {
    if (!maxW || c.measureText(para).width <= maxW) { out.push(para); return; }
    let line = "";
    para.split(/(?<= )/).forEach((word) => {
      // Trailing spaces hang past the edge (textarea pre-wrap), so ignore them when testing fit.
      if (!word.trim()) { line += word; return; }
      if (line && c.measureText((line + word).trimEnd()).width > maxW) { out.push(line); line = ""; }
      if (c.measureText(word.trimEnd()).width <= maxW) { line += word; return; }
      for (const ch of word) {
        if (ch === " ") { line += ch; continue; } // trailing space hangs, never starts a new line
        if (line && c.measureText(line + ch).width > maxW) { out.push(line); line = ""; }
        line += ch;
      }
    });
    out.push(line);
  });
  return out;
}

// Scale a text box (w, h in canvas px) by k, capped to the canvas, floored at 2*fontSize wide / one line tall.
function scaleTextBox(origW, origH, k, x, y, canvasW, canvasH, fontSize) {
  const out = { w: Math.max(2 * fontSize, Math.min(origW * k, canvasW - x)) };
  if (origH) out.h = Math.max(fontSize * 1.2, Math.min(origH * k, canvasH - y));
  return out;
}

// ---------- Line helpers (pure) ----------

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Keep |ap|, round the angle of (p - a) to the nearest 15 degrees.
function snapAngle15(a, p) {
  const len = Math.hypot(p.x - a.x, p.y - a.y);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / step) * step;
  return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) };
}

function lineHitTolerance(size, scale) {
  return Math.max(size / 2, 6 * scale);
}

function translateLine(orig, dx, dy) {
  return { x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy };
}

// Lines and arrows share endpoint editing (A = x1,y1; B = x2,y2).
function isSegmentObject(obj) {
  return obj.type === "line" || obj.type === "arrow";
}

// Arrow shape in canvas px: head at B (30 degree half-angle), shaft pulled back
// 0.6*headLen from the tip so the round cap can't poke through. Shafts shorter
// than the pull-back are skipped (head only, full size).
function arrowGeometry(x1, y1, x2, y2, size) {
  const headLen = Math.max(20, size * 3.2);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const pull = headLen * 0.6;
  const at = (a) => ({ x: x2 - headLen * Math.cos(a), y: y2 - headLen * Math.sin(a) });
  return {
    headLen,
    angle,
    hasShaft: Math.hypot(x2 - x1, y2 - y1) >= pull,
    shaftEnd: { x: x2 - pull * Math.cos(angle), y: y2 - pull * Math.sin(angle) },
    head: [{ x: x2, y: y2 }, at(angle - Math.PI / 6), at(angle + Math.PI / 6)]
  };
}

function pointInTriangle(p, a, b, c) {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function getObjectBounds(obj) {
  if (obj.type === "arrow") {
    const g = arrowGeometry(obj.x1, obj.y1, obj.x2, obj.y2, obj.size);
    const xs = [obj.x1, ...g.head.map((q) => q.x)], ys = [obj.y1, ...g.head.map((q) => q.y)];
    const pad = obj.size / 2, x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
  }
  if (obj.type === "line") {
    const pad = obj.size / 2;
    const x = Math.min(obj.x1, obj.x2) - pad, y = Math.min(obj.y1, obj.y2) - pad;
    return { x, y, w: Math.abs(obj.x2 - obj.x1) + obj.size, h: Math.abs(obj.y2 - obj.y1) + obj.size };
  }
  if (obj.type === "text") {
    ctx.font = textFont(obj.fontSize);
    const lines = wrapText(ctx, obj.text, obj.w);
    const textH = lines.length * obj.fontSize * 1.2;
    if (obj.w) return { x: obj.x, y: obj.y, w: obj.w, h: Math.max(obj.h || 0, textH) };
    let maxW = 0;
    lines.forEach((l) => {
      const w = ctx.measureText(l).width;
      if (w > maxW) maxW = w;
    });
    return { x: obj.x, y: obj.y, w: maxW, h: textH };
  }
  const x = obj.w < 0 ? obj.x + obj.w : obj.x;
  const y = obj.h < 0 ? obj.y + obj.h : obj.y;
  return { x, y, w: Math.abs(obj.w), h: Math.abs(obj.h) };
}

function normalizeObject(obj) {
  if (obj.type === "text" || isSegmentObject(obj)) return;
  if (obj.w < 0) { obj.x += obj.w; obj.w = -obj.w; }
  if (obj.h < 0) { obj.y += obj.h; obj.h = -obj.h; }
}

function drawHandles(obj) {
  const s = getDisplayScale();
  if (isSegmentObject(obj)) {
    ctx.save();
    ctx.strokeStyle = "#635bff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 1.5 * s;
    [[obj.x1, obj.y1], [obj.x2, obj.y2]].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
    return;
  }
  const b = getObjectBounds(obj);
  const hs = 8 * s;
  ctx.save();
  ctx.strokeStyle = "#635bff";
  ctx.lineWidth = 1.5 * s;
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
  ctx.fillStyle = "#fff";
  corners.forEach(([cx, cy]) => {
    ctx.beginPath();
    ctx.rect(cx - hs / 2, cy - hs / 2, hs, hs);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function hitTestHandle(obj, pos) {
  const tol = 10 * getDisplayScale();
  if (isSegmentObject(obj)) {
    // B first so a zero-length line can be re-lengthened.
    if (Math.abs(pos.x - obj.x2) <= tol && Math.abs(pos.y - obj.y2) <= tol) return "b";
    if (Math.abs(pos.x - obj.x1) <= tol && Math.abs(pos.y - obj.y1) <= tol) return "a";
    return null;
  }
  const b = getObjectBounds(obj);
  const corners = { nw: [b.x, b.y], ne: [b.x + b.w, b.y], sw: [b.x, b.y + b.h], se: [b.x + b.w, b.y + b.h] };
  for (const key in corners) {
    const [cx, cy] = corners[key];
    if (Math.abs(pos.x - cx) <= tol && Math.abs(pos.y - cy) <= tol) return key;
  }
  return null;
}

function hitTestObject(pos) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (isSegmentObject(o)) {
      const s = getDisplayScale();
      if (distToSegment(pos, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) <= lineHitTolerance(o.size, s)) return o;
      if (o.type === "arrow") {
        const h = arrowGeometry(o.x1, o.y1, o.x2, o.y2, o.size).head;
        if (pointInTriangle(pos, h[0], h[1], h[2])) return o;
      }
      continue;
    }
    const b = getObjectBounds(o);
    if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) return objects[i];
  }
  return null;
}

function cursorForHandle(handle) {
  if (handle === "a" || handle === "b") return "grab";
  return handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";
}

// Lines, arrows and text stay live vector objects through brush/blur. Consequence:
// they always draw ON TOP of raster strokes (not chronological), and blur
// never affects them. Crop is destructive, so it still flattens everything.
function isBakeExempt(obj) {
  return isSegmentObject(obj) || obj.type === "text";
}

// Split objects into those flattened into the base and those that stay live.
function partitionObjects(list, bakeAll) {
  const bake = [], keep = [];
  list.forEach((o) => (!bakeAll && isBakeExempt(o) ? keep : bake).push(o));
  return { bake, keep };
}

// Flatten live objects into the raster base — required before any tool that
// directly manipulates pixels. Exempt objects stay in `objects` but are left
// OFF the canvas (no pixels, no handles) so snapshots can't capture them;
// the stroke's finish path calls render() to show them again.
function bakeObjects(bakeAll) {
  if (!objects.length) return;
  const { bake, keep } = partitionObjects(objects, bakeAll);
  if (baseSnapshot) ctx.putImageData(baseSnapshot, 0, 0);
  bake.forEach((obj) => { if (obj.id !== editingId) drawObject(ctx, obj); });
  snapshotBase();
  if (bake.some((o) => o.id === selectedId)) selectedId = null;
  objects = keep;
}

// Non-destructive merged export (used by Copy/Download) — doesn't disturb
// the live editable objects, so editing can continue afterward.
function getMergedCanvas() {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const cctx = c.getContext("2d");
  if (baseSnapshot) cctx.putImageData(baseSnapshot, 0, 0);
  objects.forEach((obj) => drawObject(cctx, obj));
  return c;
}

function imageDataToDataURL(imgData) {
  const c = document.createElement("canvas");
  c.width = imgData.width;
  c.height = imgData.height;
  c.getContext("2d").putImageData(imgData, 0, 0);
  return c.toDataURL("image/png");
}

// ---------- History (undo/redo) ----------
// Each entry captures the full editable state (flat base + live objects),
// so undoing/redoing preserves the ability to keep moving/resizing a shape.

function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push({
    base: imageDataToDataURL(baseSnapshot),
    objects: JSON.parse(JSON.stringify(objects)),
    selectedId
  });
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function restoreFromHistory(index) {
  const entry = history[index];
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    snapshotBase();
    objects = JSON.parse(JSON.stringify(entry.objects));
    selectedId = entry.selectedId;
    fitCanvasToView();
    render();
  };
  img.src = entry.base;
}

function undo() {
  cancelActiveText();
  if (historyIndex <= 0) return;
  historyIndex--;
  restoreFromHistory(historyIndex);
  updateHistoryButtons();
}

function redo() {
  cancelActiveText();
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restoreFromHistory(historyIndex);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  document.getElementById("undoBtn").disabled = historyIndex <= 0;
  document.getElementById("redoBtn").disabled = historyIndex >= history.length - 1;
}

// True when nothing differs from the first-loaded screenshot: no objects and identical size and pixels.
function isPristine(initial, base, objs) {
  if (objs.length) return false;
  if (!initial || !base) return initial === base;
  if (initial === base) return true;
  if (initial.width !== base.width || initial.height !== base.height) return false;
  for (let i = 0; i < initial.data.length; i++) if (initial.data[i] !== base.data[i]) return false;
  return true;
}

// Reset to the screenshot as first loaded, as ONE undoable history step.
function clearAll() {
  if (isDragging || !initialBase) return;
  cancelActiveText();
  rasterPending = false;
  selectedId = null;
  if (isPristine(initialBase, baseSnapshot, objects)) { // nothing to clear: no history entry
    render();
    showToast("Nothing to clear");
    return;
  }
  canvas.width = initialBase.width;
  canvas.height = initialBase.height;
  baseSnapshot = initialBase;
  objects = [];
  fitCanvasToView();
  render();
  pushHistory(); // truncates the redo stack like any new action
  playClearEffect();
  showToast("All edits cleared — Ctrl/Cmd+Z to undo");
}

// Short pulse on the Clear all button. Restarting the animation (remove,
// reflow, add) lets repeated clicks replay it.
const clearBtn = document.getElementById("clearBtn");
function playClearEffect() {
  clearBtn.classList.remove("pulse");
  void clearBtn.offsetWidth;
  clearBtn.classList.add("pulse");
}
clearBtn.addEventListener("animationend", () => clearBtn.classList.remove("pulse"));

document.getElementById("clearBtn").addEventListener("click", clearAll);
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);

// ---------- Tool selection ----------

toolBtns.forEach((btn) => {
  btn.addEventListener("click", () => setTool(btn.dataset.tool));
});

function setTool(tool) {
  if (isDragging) return; // a switch mid-drag would wipe the unsnapshotted stroke and skip its history entry
  commitActiveText();
  rasterPending = false; // drop a half-started raster stroke so it can't bake later
  currentTool = tool;
  toolBtns.forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  cropActions.style.display = tool === "crop" ? "flex" : "none";
  canvas.style.cursor = tool === "select" ? "default" : "crosshair";
  cropRect = null;
  if (tool !== "select") {
    selectedId = null;
    render();
  }
  setControlsLocked(tool === "crop");
}

// While cropping, lock every control except the crop tool itself and the
// Apply/Cancel buttons, so a stray click can't switch tools mid-selection.
function setControlsLocked(locked) {
  toolBtns.forEach((b) => {
    if (b.dataset.tool !== "crop") b.disabled = locked;
  });
  document.querySelectorAll(".swatch").forEach((s) => (s.disabled = locked));
  sizeRange.disabled = locked;
  fontSizeRange.disabled = locked;
  document.getElementById("copyBtn").disabled = locked;
  document.getElementById("downloadBtn").disabled = locked;

  document.getElementById("clearBtn").disabled = locked;
  if (locked) {
    document.getElementById("undoBtn").disabled = true;
    document.getElementById("redoBtn").disabled = true;
  } else {
    updateHistoryButtons(); // restore correct enabled/disabled state from history
  }
}

const keyMap = { v: "select", s: "select", x: "crop", b: "brush", a: "arrow", r: "rect", o: "ellipse", l: "line", t: "text", p: "blur" };
// ---------- Keyboard shortcuts panel ----------

const helpOverlay = document.getElementById("helpOverlay");
function setHelpOpen(open) {
  helpOverlay.style.display = open ? "" : "none";
  if (open) document.getElementById("helpClose").focus();
  else document.getElementById("helpBtn").focus();
}
document.getElementById("helpBtn").addEventListener("click", () => setHelpOpen(true));
document.getElementById("helpClose").addEventListener("click", () => setHelpOpen(false));
helpOverlay.addEventListener("click", (e) => { if (e.target === helpOverlay) setHelpOpen(false); });

document.addEventListener("keydown", (e) => {
  if (document.activeElement === textInput) return;
  if (helpOverlay.style.display !== "none") { // the panel takes over the keyboard while open
    if (e.key === "Escape" || e.key === "?") { e.preventDefault(); setHelpOpen(false); }
    return;
  }
  if (e.key === "?" && !isDragging) { e.preventDefault(); setHelpOpen(true); return; }
  if (isDragging) return; // ignore all shortcuts (tools, undo/redo, copy, delete) while a drag is held
  if (e.key === "Escape" && currentTool === "crop") { e.preventDefault(); document.getElementById("cancelCrop").click(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    e.preventDefault();
    const copyBtn = document.getElementById("copyBtn");
    if (!copyBtn.disabled) copyBtn.click();
    return;
  }
  // Other Ctrl/Cmd combos (Ctrl+R, Ctrl+A, ...) shouldn't switch tools.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key === "Delete" || e.key === "Backspace") && currentTool === "select" && selectedId !== null) {
    e.preventDefault();
    objects = objects.filter((o) => o.id !== selectedId);
    selectedId = null;
    render();
    pushHistory();
    return;
  }
  if (keyMap[e.key.toLowerCase()]) setTool(keyMap[e.key.toLowerCase()]);
});

// ---------- Color & size ----------

colorGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".swatch");
  if (!btn) return;
  currentColor = btn.dataset.color;
  document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
  btn.classList.add("active");
  if (activeText) {
    activeText.color = currentColor;
    syncTextOverlay();
    textInput.focus();
  }
});

sizeRange.addEventListener("input", (e) => {
  currentSize = parseInt(e.target.value, 10);
});

const fontSizeRange = document.getElementById("fontSizeRange");
fontSizeRange.addEventListener("input", (e) => {
  currentFontSize = parseInt(e.target.value, 10);
  if (activeText) {
    activeText.fontSize = Math.round(currentFontSize * getDisplayScale());
    clampTextBox(activeText);
    syncTextOverlay();
    autoGrowText();
  }
});
fontSizeRange.addEventListener("change", () => { if (activeText) textInput.focus(); });

// ---------- Coordinate helpers ----------

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

// ---------- Drawing interactions ----------

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // only the primary button draws; a right-click menu would swallow pointerup
  rasterPending = false; // never carry a stale flag into a new gesture
  const pos = getPos(e);

  if (currentTool === "select") {
    const sel = objects.find((o) => o.id === selectedId);
    if (sel) {
      const handle = hitTestHandle(sel, pos);
      if (handle && isSegmentObject(sel)) {
        canvas.setPointerCapture(e.pointerId);
        dragMode = "endpoint";
        dragHandle = handle;
        dragObj = sel;
        dragLineOrig = { x1: sel.x1, y1: sel.y1, x2: sel.x2, y2: sel.y2 };
        isDragging = true;
        return;
      }
      if (handle) {
        canvas.setPointerCapture(e.pointerId);
        dragMode = "resize";
        dragHandle = handle;
        dragObj = sel;
        dragOrigBounds = getObjectBounds(sel);
        dragObj._origFontSize = dragObj.fontSize;
        dragObj._origW = dragObj.w;
        dragObj._origH = dragObj.h;
        isDragging = true;
        return;
      }
    }
    const hit = hitTestObject(pos);
    if (hit) {
      canvas.setPointerCapture(e.pointerId);
      selectedId = hit.id;
      dragMode = "move";
      dragObj = hit;
      if (isSegmentObject(hit)) {
        dragLineOrig = { x1: hit.x1, y1: hit.y1, x2: hit.x2, y2: hit.y2 };
        dragOffset = pos; // pointer start; the line moves by the pointer delta
      } else {
        dragOrigBounds = getObjectBounds(hit);
        const b = dragOrigBounds;
        dragOffset = { x: pos.x - b.x, y: pos.y - b.y };
      }
      isDragging = true;
      render();
    } else {
      selectedId = null;
      render();
    }
    return;
  }

  canvas.setPointerCapture(e.pointerId); // lock subsequent events to canvas even if cursor leaves it

  if (currentTool === "text") {
    e.preventDefault(); // stop the browser from stealing focus back after mousedown
    canvas.releasePointerCapture(e.pointerId);
    commitActiveText();
    openNewTextBox(pos);
    return;
  }

  if (currentTool === "rect" || currentTool === "ellipse") {
    const obj = { id: nextObjId++, type: currentTool, x: pos.x, y: pos.y, w: 0, h: 0, color: currentColor, size: currentSize };
    objects.push(obj);
    selectedId = obj.id;
    dragMode = "create";
    dragObj = obj;
    dragStart = pos;
    isDragging = true;
    return;
  }

  if (currentTool === "line" || currentTool === "arrow") {
    // The object is only created once the pointer moves past the jitter threshold.
    dragMode = "create";
    dragObj = null;
    dragStart = pos;
    isDragging = true;
    return;
  }

  // Brush/blur need flat pixels, but flattening is deferred until the
  // pointer actually moves (startRasterStroke) so a double-click can still
  // hit and re-edit a text object. Crop flattens immediately.
  if (["crop", "blur", "brush"].includes(currentTool)) {
    isDragging = true;
    dragStart = pos;
    if (currentTool === "crop") {
      if (objects.length) bakeObjects(true);
      if (baseSnapshot) ctx.putImageData(baseSnapshot, 0, 0); // drop any previous crop overlay before capturing the clean image
      snapshotBeforeDrag = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else {
      rasterPending = true;
    }
  }
});

function startRasterStroke() {
  rasterPending = false;
  if (objects.length) bakeObjects(false);
  if (currentTool === "brush") {
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  } else {
    snapshotBeforeDrag = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
}

canvas.addEventListener("pointermove", (e) => {
  const pos = getPos(e);

  // Hover feedback for the select tool, even when not dragging
  if (currentTool === "select" && !isDragging) {
    const sel = objects.find((o) => o.id === selectedId);
    let cursor = "default";
    if (sel) {
      const handle = hitTestHandle(sel, pos);
      if (handle) cursor = cursorForHandle(handle);
      else if (hitTestObject(pos)) cursor = "move";
    } else if (hitTestObject(pos)) {
      cursor = "move";
    }
    canvas.style.cursor = cursor;
  }

  if (!isDragging) return;

  if (currentTool === "select") {
    if (dragMode === "move" && dragObj && isSegmentObject(dragObj)) {
      Object.assign(dragObj, translateLine(dragLineOrig, pos.x - dragOffset.x, pos.y - dragOffset.y));
      render();
    } else if (dragMode === "endpoint" && dragObj) {
      const a = dragHandle === "a";
      const fixed = a ? { x: dragLineOrig.x2, y: dragLineOrig.y2 } : { x: dragLineOrig.x1, y: dragLineOrig.y1 };
      const p = e.shiftKey ? snapAngle15(fixed, pos) : pos;
      if (a) { dragObj.x1 = p.x; dragObj.y1 = p.y; } else { dragObj.x2 = p.x; dragObj.y2 = p.y; }
      render();
    } else if (dragMode === "move" && dragObj) {
      dragObj.x = pos.x - dragOffset.x;
      dragObj.y = pos.y - dragOffset.y;
      render();
    } else if (dragMode === "resize" && dragObj) {
      const b = dragOrigBounds;
      let nx = b.x, ny = b.y, nw = b.w, nh = b.h;
      if (dragHandle.includes("n")) { ny = pos.y; nh = b.y + b.h - pos.y; }
      if (dragHandle.includes("s")) { nh = pos.y - b.y; }
      if (dragHandle.includes("w")) { nx = pos.x; nw = b.x + b.w - pos.x; }
      if (dragHandle.includes("e")) { nw = pos.x - b.x; }

      if (dragObj.type === "text") {
        const scale = Math.max(0.2, nh / b.h);
        dragObj.fontSize = Math.max(8, Math.round(dragObj._origFontSize * scale));
        if (dragObj._origW) {
          const k = dragObj.fontSize / dragObj._origFontSize;
          Object.assign(dragObj, scaleTextBox(dragObj._origW, dragObj._origH, k, dragObj.x, dragObj.y, canvas.width, canvas.height, dragObj.fontSize));
        }
      } else {
        dragObj.x = nx; dragObj.y = ny; dragObj.w = nw; dragObj.h = nh;
      }
      render();
    }
    return;
  }

  if (currentTool === "line" || currentTool === "arrow") {
    if (dragMode !== "create") return;
    if (!dragObj) {
      if (Math.hypot(pos.x - dragStart.x, pos.y - dragStart.y) < 3 * getDisplayScale()) return;
      dragObj = { id: nextObjId++, type: currentTool, x1: dragStart.x, y1: dragStart.y, x2: pos.x, y2: pos.y, color: currentColor, size: currentSize };
      objects.push(dragObj);
      selectedId = dragObj.id;
    }
    const p = e.shiftKey ? snapAngle15(dragStart, pos) : pos;
    dragObj.x2 = p.x;
    dragObj.y2 = p.y;
    render();
    return;
  }

  if (rasterPending) {
    // Ignore click jitter (< 3 screen px) so a double-click never draws or bakes.
    if (Math.hypot(pos.x - dragStart.x, pos.y - dragStart.y) < 3 * getDisplayScale()) return;
    startRasterStroke();
  }

  if (currentTool === "brush") {
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    return;
  }

  if (currentTool === "rect" || currentTool === "ellipse") {
    if (dragMode === "create" && dragObj) {
      dragObj.w = pos.x - dragStart.x;
      dragObj.h = pos.y - dragStart.y;
      render();
    }
    return;
  }

  if (["crop", "blur"].includes(currentTool)) {
    ctx.putImageData(snapshotBeforeDrag, 0, 0);
    drawPreviewShape(currentTool, dragStart, pos);
  }
});

function finishDrag(e) {
  if (!isDragging) return;
  isDragging = false;
  if (canvas.hasPointerCapture && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }

  if (currentTool === "select") {
    if (dragObj && isSegmentObject(dragObj) && (dragMode === "move" || dragMode === "endpoint")) {
      const o = dragLineOrig, n = dragObj;
      const changed = Math.abs(n.x1 - o.x1) > 0.5 || Math.abs(n.y1 - o.y1) > 0.5 || Math.abs(n.x2 - o.x2) > 0.5 || Math.abs(n.y2 - o.y2) > 0.5;
      render();
      if (changed) pushHistory();
      dragLineOrig = null;
    } else if (dragMode === "move" && dragObj) {
      const moved = Math.abs(dragObj.x - dragOrigBounds.x) > 0.5 || Math.abs(dragObj.y - dragOrigBounds.y) > 0.5;
      render();
      if (moved) pushHistory();
    } else if (dragMode === "resize" && dragObj) {
      normalizeObject(dragObj);
      const b2 = getObjectBounds(dragObj);
      const changed =
        Math.abs(b2.w - dragOrigBounds.w) > 0.5 ||
        Math.abs(b2.h - dragOrigBounds.h) > 0.5 ||
        Math.abs(b2.x - dragOrigBounds.x) > 0.5 ||
        Math.abs(b2.y - dragOrigBounds.y) > 0.5;
      render();
      if (changed) pushHistory();
    }
    dragMode = null;
    dragObj = null;
    dragHandle = null;
    return;
  }

  if (currentTool === "line" || currentTool === "arrow") {
    if (dragMode === "create" && dragObj) {
      selectedId = dragObj.id;
      render();
      pushHistory();
    }
    dragMode = null;
    dragObj = null;
    return;
  }

  if (rasterPending) { rasterPending = false; dragStart = null; return; } // plain click: nothing drawn, no history

  if (currentTool === "brush") {
    snapshotBase();
    render();
    pushHistory();
    return;
  }

  if (currentTool === "rect" || currentTool === "ellipse") {
    if (dragMode === "create" && dragObj) {
      normalizeObject(dragObj);
      if (Math.abs(dragObj.w) < 3 || Math.abs(dragObj.h) < 3) {
        objects = objects.filter((o) => o.id !== dragObj.id);
        selectedId = null;
      } else {
        selectedId = dragObj.id;
      }
      render();
      pushHistory();
    }
    dragMode = null;
    dragObj = null;
    return;
  }

  if (!dragStart) return;
  const pos = getPos(e);

  if (currentTool === "crop") {
    ctx.putImageData(snapshotBeforeDrag, 0, 0);
    cropRect = normalizeRect(dragStart, pos);
    drawCropOverlay(cropRect);
    return; // committed via "Apply Crop" button
  }

  if (currentTool === "blur") {
    ctx.putImageData(snapshotBeforeDrag, 0, 0);
    const r = normalizeRect(dragStart, pos);
    if (r.w > 3 && r.h > 3) applyPixelation(r);
    snapshotBase();
    render();
    pushHistory();
    return;
  }

}

canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);

function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y)
  };
}

function drawPreviewShape(tool, start, end) {
  ctx.strokeStyle = currentColor;
  ctx.fillStyle = currentColor;
  ctx.lineWidth = currentSize;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (tool === "crop") {
    const r = normalizeRect(start, end);
    drawCropOverlay(r);
  } else if (tool === "blur") {
    const r = normalizeRect(start, end);
    ctx.save();
    ctx.strokeStyle = "#635bff";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
}

function drawCropOverlay(r) {
  ctx.save();
  ctx.strokeStyle = "#635bff";
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

// ---------- Crop apply/cancel ----------

document.getElementById("applyCrop").addEventListener("click", () => {
  if (!cropRect || cropRect.w < 3 || cropRect.h < 3) {
    showToast("Drag to select a crop area first");
    return;
  }
  // Restore the clean image first — the canvas currently still shows the
  // dimmed selection overlay + blue border, which must never be baked
  // into the actual output.
  if (snapshotBeforeDrag) ctx.putImageData(snapshotBeforeDrag, 0, 0);
  const imgData = ctx.getImageData(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
  canvas.width = cropRect.w;
  canvas.height = cropRect.h;
  ctx.putImageData(imgData, 0, 0);
  snapshotBase();
  fitCanvasToView();
  pushHistory();
  cropRect = null;
  setTool("select");
});

document.getElementById("cancelCrop").addEventListener("click", () => {
  if (historyIndex >= 0) restoreFromHistory(historyIndex);
  cropRect = null;
  setTool("select");
});

// ---------- Blur / pixelate ----------

function applyPixelation(r) {
  const blockSize = Math.max(6, Math.round(currentSize * 1.5));
  const region = ctx.getImageData(r.x, r.y, r.w, r.h);

  const temp = document.createElement("canvas");
  temp.width = r.w;
  temp.height = r.h;
  const tctx = temp.getContext("2d");
  tctx.putImageData(region, 0, 0);

  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.floor(r.w / blockSize));
  small.height = Math.max(1, Math.floor(r.h / blockSize));
  const sctx = small.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(temp, 0, 0, small.width, small.height);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.w, r.h);
  ctx.imageSmoothingEnabled = true;
}

// ---------- Text tool ----------
// A persistent, resizable box (PowerPoint-style). `activeText` holds the box in
// canvas px: {x, y, w, h, fontSize, color, editId, start}. The overlay is sized
// in CSS px = canvas px / getDisplayScale(), so on-screen wrap == canvas wrap.
// It is committed (one pushHistory) on Esc, tool switch, click outside the
// canvas, new click on canvas, undo/redo, copy/download. Never on blur.

function clampTextBox(b) {
  const minW = Math.min(2 * b.fontSize, canvas.width);
  const minH = Math.min(b.fontSize * 1.2, canvas.height);
  b.w = Math.min(Math.max(b.w, minW), canvas.width);
  b.h = Math.min(Math.max(b.h, minH), canvas.height);
  b.x = Math.min(Math.max(b.x, 0), canvas.width - b.w);
  b.y = Math.min(Math.max(b.y, 0), canvas.height - b.h);
}

function syncTextOverlay() {
  const a = activeText;
  const s = getDisplayScale();
  const cr = canvas.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  textOverlay.style.display = "block";
  textOverlay.style.left = cr.left - wr.left + wrap.scrollLeft + a.x / s + "px";
  textOverlay.style.top = cr.top - wr.top + wrap.scrollTop + a.y / s + "px";
  textOverlay.style.width = a.w / s + "px";
  textOverlay.style.height = a.h / s + "px";
  textInput.style.font = textFont(a.fontSize / s);
  textInput.style.lineHeight = "1.2";
  textInput.style.color = a.color;
}

// Grow h (never shrink) when the text needs more room, capped at the canvas bottom.
function autoGrowText() {
  const a = activeText;
  const s = getDisplayScale();
  textInput.style.overflowY = "hidden";
  const needed = textInput.scrollHeight * s;
  if (needed <= a.h + 0.5) return;
  const cap = canvas.height - a.y;
  a.h = Math.min(needed, cap);
  if (needed > cap + 0.5) textInput.style.overflowY = "auto";
  syncTextOverlay();
}

function openTextBox(box, text, editObj) {
  commitActiveText();
  clampTextBox(box);
  box.editId = editObj ? editObj.id : null;
  activeText = box;
  editingId = box.editId;
  textInput.value = text;
  syncTextOverlay();
  autoGrowText();
  const { x, y, w, h, fontSize, color } = box;
  box.start = { text, x, y, w, h, fontSize, color };
  render(); // hides the object being re-edited
  // Delay focus so the browser's default mousedown focus handling can't steal it back.
  setTimeout(() => {
    if (activeText !== box) return;
    textInput.focus();
    textInput.setSelectionRange(text.length, text.length);
  }, 0);
}

function openNewTextBox(pos) {
  const s = getDisplayScale();
  const fontSize = Math.round(currentFontSize * s);
  openTextBox({ x: pos.x, y: pos.y, w: 240 * s, h: fontSize * 1.2, fontSize, color: currentColor }, "", null);
}

// Discard the open box without touching history. A re-edited object is only
// hidden (never mutated) while editing, so un-hiding restores it unchanged.
function cancelActiveText() {
  if (!activeText) return;
  activeText = null;
  editingId = null;
  textInput.blur();
  textOverlay.style.display = "none";
  render();
}

function commitActiveText() {
  const a = activeText;
  if (!a) return;
  const value = textInput.value.replace(/\s+$/, "");
  activeText = null;
  editingId = null;
  textInput.blur();
  textOverlay.style.display = "none";
  selectedId = null;
  if (a.editId === null) {
    if (!value.trim()) { render(); return; }
    objects.push({ id: nextObjId++, type: "text", x: a.x, y: a.y, w: a.w, h: a.h, text: value, color: a.color, fontSize: a.fontSize });
    render();
    pushHistory();
    return;
  }
  const obj = objects.find((o) => o.id === a.editId);
  if (!obj) { render(); return; }
  if (!value.trim()) {
    objects = objects.filter((o) => o.id !== obj.id);
    render();
    pushHistory();
    return;
  }
  const st = a.start;
  const changed = value !== st.text || ["x", "y", "w", "h", "fontSize", "color"].some((k) => a[k] !== st[k]);
  if (changed) {
    Object.assign(obj, { text: value, x: a.x, y: a.y, w: a.w, h: a.h, color: a.color, fontSize: a.fontSize });
    pushHistory();
  }
  render();
}

// Re-edit an existing text object in place (any tool).
function reeditTextAt(e) {
  const hit = hitTestObject(getPos(e));
  if (!hit || hit.type !== "text") return;
  const id = hit.id;
  commitActiveText();
  const obj = objects.find((o) => o.id === id);
  if (!obj) return;
  setTool("text");
  const s = getDisplayScale();
  const b = getObjectBounds(obj);
  // Legacy objects have no w: add a little slack so the textarea doesn't wrap early.
  const w = obj.w ? b.w : b.w + obj.fontSize * 0.5;
  currentFontSize = Math.min(+fontSizeRange.max, Math.max(+fontSizeRange.min, Math.round(obj.fontSize / s)));
  fontSizeRange.value = currentFontSize;
  openTextBox({ x: obj.x, y: obj.y, w, h: b.h, fontSize: obj.fontSize, color: obj.color }, obj.text, obj);
}

canvas.addEventListener("dblclick", reeditTextAt);
// A fresh empty box may be covering the text the user is double-clicking.
textInput.addEventListener("dblclick", (e) => {
  if (activeText && activeText.editId === null && !textInput.value.trim()) reeditTextAt(e);
});

textInput.addEventListener("input", () => { if (activeText) autoGrowText(); });
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    commitActiveText(); // tool stays "text"
  }
});

// Click outside the screenshot (not canvas / box / a control) commits.
document.addEventListener("pointerdown", (e) => {
  if (!activeText) return;
  if (e.target.closest("#mainCanvas, #textInputOverlay, button, input")) return;
  commitActiveText();
});

// Resize handles (8) on the overlay.
let textDrag = null;
textOverlay.querySelectorAll(".tb-handle").forEach((hd) => {
  hd.addEventListener("pointerdown", (e) => {
    if (!activeText) return;
    e.preventDefault();
    e.stopPropagation();
    hd.setPointerCapture(e.pointerId);
    const { x, y, w, h } = activeText;
    textDrag = { dir: hd.dataset.dir, cx: e.clientX, cy: e.clientY, x, y, w, h };
  });
  hd.addEventListener("pointermove", (e) => {
    if (!textDrag || !activeText || !hd.hasPointerCapture(e.pointerId)) return;
    const a = activeText, d = textDrag, s = getDisplayScale();
    const dx = (e.clientX - d.cx) * s, dy = (e.clientY - d.cy) * s;
    const minW = Math.min(2 * a.fontSize, canvas.width), minH = Math.min(a.fontSize * 1.2, canvas.height);
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    let L = d.x, R = d.x + d.w, T = d.y, B = d.y + d.h;
    if (d.dir.includes("w")) L = clamp(d.x + dx, 0, R - minW);
    if (d.dir.includes("e")) R = clamp(d.x + d.w + dx, L + minW, canvas.width);
    if (d.dir.includes("n")) T = clamp(d.y + dy, 0, B - minH);
    if (d.dir.includes("s")) B = clamp(d.y + d.h + dy, T + minH, canvas.height);
    Object.assign(a, { x: L, y: T, w: R - L, h: B - T });
    syncTextOverlay();
    autoGrowText();
  });
  const end = (e) => {
    if (!textDrag) return;
    textDrag = null;
    if (hd.hasPointerCapture(e.pointerId)) hd.releasePointerCapture(e.pointerId);
    textInput.focus();
  };
  hd.addEventListener("pointerup", end);
  hd.addEventListener("pointercancel", end);
});

// ---------- Copy / Download ----------
// Both export a merged (base + live objects) image without baking them,
// so editing can continue afterward.

document.getElementById("copyBtn").addEventListener("click", async () => {
  commitActiveText();
  try {
    const merged = getMergedCanvas();
    const blob = await new Promise((resolve) => merged.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showToast("Copied to clipboard");
  } catch (err) {
    showToast("Copy failed — try Download instead");
  }
});

document.getElementById("downloadBtn").addEventListener("click", () => {
  commitActiveText();
  const merged = getMergedCanvas();
  const link = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  link.download = `capturepen-${ts}.png`;
  link.href = merged.toDataURL("image/png");
  link.click();
  showToast("Downloaded");
});

// ---------- Toast ----------

let toastTimer = null;
// Short notices ("Copied") stay 3s; longer messages stay 7s so they can be read.
function showToast(msg, ms = msg.length > 30 ? 7000 : 3000) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), ms);
}

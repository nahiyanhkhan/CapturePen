(async () => {
  if (window.__capturepenFullPageActive) return;
  window.__capturepenFullPageActive = true;

  const badge = document.createElement("div");
  badge.textContent = "CapturePen: capturing full page…";
  Object.assign(badge.style, {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#1a1a2e",
    color: "#fff",
    padding: "8px 14px",
    borderRadius: "8px",
    fontFamily: "-apple-system, sans-serif",
    fontSize: "13px",
    zIndex: "2147483647",
    pointerEvents: "none"
  });
  document.body.appendChild(badge);

  const originalScrollY = window.scrollY;
  const originalOverflow = document.documentElement.style.overflow;

  const SLOP = 4; // px tolerance when deciding "does this scroll?"
  const MIN_CAPTURE_GAP = 550; // Chrome allows ~2 captureVisibleTab calls/sec
  const MAX_CANVAS_PX = 32767; // Chrome's canvas dimension limit
  let lastCaptureAt = 0;
  const restoreFns = []; // run in finally, whatever happens

  function wait(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async function captureStep(retries = 2) {
    const sinceLast = Date.now() - lastCaptureAt;
    if (sinceLast < MIN_CAPTURE_GAP) await wait(MIN_CAPTURE_GAP - sinceLast);
    badge.style.visibility = "hidden";
    await wait(50); // let the badge disappear from the painted frame
    let resp;
    try {
      // A synchronous throw inside the executor rejects this promise.
      resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "capture-step" }, (r) => {
          void chrome.runtime.lastError; // mark as checked
          resolve(r);
        });
      });
    } finally {
      lastCaptureAt = Date.now();
      badge.style.visibility = "";
    }
    if (resp && resp.ok) return resp.dataUrl;
    if (retries > 0) return captureStep(retries - 1);
    return null;
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Largest (by visible area) element that scrolls vertically on its own.
  function findInnerScroller() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll("*")) {
      if (el === document.documentElement || el === badge) continue;
      if (el.scrollHeight <= el.clientHeight + SLOP) continue;
      const cs = getComputedStyle(el);
      if (!/^(auto|scroll|overlay)$/.test(cs.overflowY)) continue;
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0) continue;
      // Ignore sidebars, chat panels, dropdowns: too small to be the page.
      if (w * h < 0.3 * vw * vh || h < 0.5 * vh) continue;
      if (w * h > bestArea) {
        bestArea = w * h;
        best = el;
      }
    }
    return best;
  }

  // visibility:hidden keeps layout, so nothing shifts. Restored via restoreFns.
  function hideEl(el) {
    const prev = el.style.getPropertyValue("visibility");
    const prio = el.style.getPropertyPriority("visibility");
    el.style.setProperty("visibility", "hidden", "important");
    restoreFns.push(() => {
      if (prev) el.style.setProperty("visibility", prev, prio);
      else el.style.removeProperty("visibility");
    });
  }

  // Hide fixed/sticky descendants of the scroller, and fixed elements
  // outside it that overlap its visible band (chat launchers, cookie bars),
  // so they are not repeated in every band.
  function hideRepeatingElements(scroller, band) {
    for (const el of document.querySelectorAll("*")) {
      if (el === badge || el.contains(scroller)) continue;
      const pos = getComputedStyle(el).position;
      if (scroller.contains(el)) {
        if (pos === "fixed" || pos === "sticky") hideEl(el);
      } else if (pos === "fixed") {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 &&
            r.left < band.r && r.right > band.l && r.top < band.b && r.bottom > band.t) {
          hideEl(el);
        }
      }
    }
  }

  // Wrap everything so a failure can never leave the page's capture
  // state stuck — cleanup always runs, and errors show up as a toast
  // instead of silently doing nothing on the next click.
  try {
    const docHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );
    const viewportHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    // Pick what scrolls: whichever of the window and the best inner
    // scroller has more hidden content.
    const se = document.scrollingElement || document.documentElement;
    const docExtra = Math.max(se.scrollHeight - viewportHeight, docHeight - viewportHeight);
    const candidate = findInnerScroller();
    const candExtra = candidate ? candidate.scrollHeight - candidate.clientHeight : 0;
    let scroller = null;
    let useWindow = docExtra > SLOP;
    if (candidate && candExtra > SLOP && (!useWindow || candExtra > docExtra)) {
      scroller = candidate;
      useWindow = false;
    } else if (useWindow) {
      // Confirm the window really scrolls (html overflow:hidden would block it).
      // Already scrolled down proves it; otherwise probe downwards without
      // smooth scrolling so the check is instant and invisible.
      const before = window.scrollY;
      let moved = before > 0;
      if (!moved) {
        const prevBehavior = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = "auto";
        window.scrollTo(0, Math.min(viewportHeight, docExtra));
        await wait(100);
        moved = window.scrollY !== before;
        window.scrollTo(0, before);
        document.documentElement.style.scrollBehavior = prevBehavior;
      }
      if (!moved) {
        useWindow = false;
        if (candidate && candExtra > SLOP) scroller = candidate;
      }
    }

    document.documentElement.style.overflow = "hidden";
    const htmlScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    restoreFns.push(() => {
      document.documentElement.style.scrollBehavior = htmlScrollBehavior;
    });

    let canvas;
    if (scroller) {
      const prevTop = scroller.scrollTop;
      const prevBehavior = scroller.style.scrollBehavior;
      scroller.style.scrollBehavior = "auto";
      restoreFns.push(() => {
        scroller.style.scrollBehavior = prevBehavior;
        scroller.scrollTop = prevTop;
      });

      scroller.scrollTop = 0;
      await wait(250);

      const hiddenExtra = scroller.scrollHeight - scroller.clientHeight; // max scroll, CSS px
      const rect = scroller.getBoundingClientRect();
      const bandL = Math.max(rect.left + scroller.clientLeft, 0);
      const bandR = Math.min(rect.left + scroller.clientLeft + scroller.clientWidth, window.innerWidth);
      const bandT = Math.max(rect.top + scroller.clientTop, 0);
      const bandB = Math.min(rect.top + scroller.clientTop + scroller.clientHeight, viewportHeight);
      const visH = bandB - bandT; // may be < clientHeight if an ancestor clips it
      const step = Math.max(1, visH - 1); // 1px overlap avoids hairline seams

      const first = await captureStep();
      if (!first) throw new Error("No frames captured — try again.");
      const firstImg = await loadImg(first);
      const scale = firstImg.width / window.innerWidth || dpr;

      // Cap total height at the canvas limit.
      const extra = Math.max(0, Math.min(hiddenExtra, MAX_CANVAS_PX / scale - viewportHeight));
      const outH = Math.round((viewportHeight + extra) * scale);

      canvas = document.createElement("canvas");
      canvas.width = firstImg.width;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      const sy = (v) => Math.round(v * scale);

      // White base, rows above/including the scroller, then the part below
      // the scroller shifted down.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(firstImg, 0, 0, firstImg.width, sy(bandB), 0, 0, firstImg.width, sy(bandB));
      if (bandB < viewportHeight) {
        ctx.drawImage(
          firstImg,
          0, sy(bandB), firstImg.width, firstImg.height - sy(bandB),
          0, sy(bandB + extra), firstImg.width, firstImg.height - sy(bandB)
        );
      }

      hideRepeatingElements(scroller, { l: bandL, r: bandR, t: bandT, b: bandB });

      let prevScroll = 0;
      while (prevScroll < extra - 1) {
        scroller.scrollTop = Math.min(prevScroll + step, extra);
        await wait(250);
        const s = scroller.scrollTop; // real position (may be clamped)
        if (s <= prevScroll) break;
        const dataUrl = await captureStep();
        if (!dataUrl) throw new Error("Capture failed part-way — try again.");
        const img = await loadImg(dataUrl);
        const w = sy(bandR) - sy(bandL);
        const h = sy(bandB) - sy(bandT);
        ctx.drawImage(img, sy(bandL), sy(bandT), w, h, sy(bandL), sy(bandT + s), w, h);
        prevScroll = s;
      }
    } else {
      const pageHeight = useWindow ? docHeight : viewportHeight; // single shot if nothing scrolls
      const maxScrollable = Math.min(pageHeight, MAX_CANVAS_PX / dpr);
      const steps = Math.ceil(maxScrollable / viewportHeight);
      const shots = [];

      window.scrollTo(0, 0);
      await wait(200);

      for (let i = 0; i < steps; i++) {
        window.scrollTo(0, i * viewportHeight);
        await wait(250);
        const dataUrl = await captureStep();
        if (dataUrl) shots.push({ dataUrl, scrollTop: window.scrollY });
      }

      if (shots.length === 0) {
        throw new Error("No frames captured — try again or use a smaller page.");
      }

      const images = await Promise.all(shots.map((s) => loadImg(s.dataUrl)));
      canvas = document.createElement("canvas");
      canvas.width = images[0].width;
      canvas.height = Math.min(Math.round(pageHeight * dpr), MAX_CANVAS_PX);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      images.forEach((img, i) => {
        ctx.drawImage(img, 0, Math.round(shots[i].scrollTop * dpr));
      });
    }

    const finalDataUrl = canvas.toDataURL("image/png");
    chrome.runtime.sendMessage({ action: "full-page-done", dataUrl: finalDataUrl });
  } catch (err) {
    badge.textContent = "CapturePen: full-page capture failed — " + err.message;
    setTimeout(() => badge.remove(), 3000);
    console.error("CapturePen full-page capture error:", err);
  } finally {
    while (restoreFns.length) {
      try { restoreFns.pop()(); } catch (e) { /* keep restoring */ }
    }
    window.scrollTo(0, originalScrollY);
    document.documentElement.style.overflow = originalOverflow;
    if (badge.isConnected && badge.textContent.indexOf("failed") === -1) badge.remove();
    window.__capturepenFullPageActive = false;
  }
})();

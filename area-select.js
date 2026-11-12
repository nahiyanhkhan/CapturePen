(() => {
  if (window.__capturepenAreaSelectActive) return;
  window.__capturepenAreaSelectActive = true;

  const overlay = document.createElement("div");
  overlay.id = "__capturepen_overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "transparent",
    userSelect: "none"
  });

  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    border: "2px solid #635bff",
    background: "transparent",
    display: "none",
    zIndex: "2147483647",
    pointerEvents: "none" // let mouse events pass through to the overlay underneath
  });

  const hint = document.createElement("div");
  hint.textContent = "Drag to select an area · Esc to cancel";
  Object.assign(hint.style, {
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

  document.body.appendChild(overlay);
  document.body.appendChild(box);
  document.body.appendChild(hint);

  let startX, startY, isDragging = false;

  function cleanup() {
    overlay.remove();
    box.remove();
    hint.remove();
    window.__capturepenAreaSelectActive = false;
    document.removeEventListener("keydown", onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") cleanup();
  }
  document.addEventListener("keydown", onKeyDown);

  overlay.addEventListener("mousedown", (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.display = "block";
    box.style.left = startX + "px";
    box.style.top = startY + "px";
    box.style.width = "0px";
    box.style.height = "0px";
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!isDragging) return;
    isDragging = false;
    const rect = box.getBoundingClientRect();
    cleanup();

    if (rect.width < 5 || rect.height < 5) return; // ignore accidental clicks

    // Wait for the browser to actually repaint the page without our overlay/
    // border/hint before asking for the screenshot — otherwise captureVisibleTab
    // can fire before the DOM removal above has been reflected on screen,
    // baking our own selection UI into the captured image.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chrome.runtime.sendMessage({
          action: "area-selected",
          rect: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          },
          dpr: window.devicePixelRatio || 1
        });
      });
    });
  });
})();

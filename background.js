// background.js — service worker
// Handles: visible-tab capture, full-page capture, area-select trigger, opening editor

async function captureVisible(windowId) {
  return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

async function storeAndOpenEditor(dataUrl) {
  // Drop any crop left over from an earlier area capture, or the editor would
  // crop this full image to that old selection.
  await chrome.storage.session.set({
    capturepen_image: dataUrl,
    capturepen_ts: Date.now(),
    capturepen_crop: null,
    capturepen_dpr: null
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
}

// Chrome never lets extensions capture or inject into its own pages
// (chrome://, the Web Store, other extensions). Check up front and tell the
// user via the toolbar badge instead of failing with a logged error.
function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|chrome-untrusted|chrome-search|edge|about|devtools|view-source):/.test(url) ||
    url.startsWith("https://chromewebstore.google.com") ||
    url.startsWith("https://chrome.google.com/webstore");
}

function showBlocked(tab, customTitle) {
  const tabId = tab.id;
  const restricted = isRestrictedUrl(tab.url);
  const title = customTitle ? customTitle : restricted
    ? "CapturePen can't capture this page. Chrome doesn't allow extensions on its own pages (chrome://, New Tab, Settings) or the Chrome Web Store. Switch to a regular web page and try again."
    : "CapturePen couldn't capture this page" + (tab.url?.startsWith("file:") ? " — turn on \"Allow access to file URLs\" for CapturePen" : "");
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: "!" }).catch(() => {});
  chrome.action.setTitle({ tabId, title }).catch(() => {});
}

// Keep the badge until the tab goes to another page, so there's time to hover
// the icon and read the message.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  chrome.action.setTitle({ tabId, title: chrome.runtime.getManifest().action.default_title }).catch(() => {});
});

async function handleVisibleCapture(tab) {
  if (isRestrictedUrl(tab.url)) { showBlocked(tab); return; }
  try {
    const dataUrl = await captureVisible(tab.windowId);
    await storeAndOpenEditor(dataUrl);
  } catch (e) {
    console.warn("CapturePen capture failed:", e);
    showBlocked(tab);
  }
}

async function handleAreaCapture(tab) {
  if (isRestrictedUrl(tab.url)) { showBlocked(tab); return; }
  // Inject the area-select overlay into the page
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["area-select.js"]
    });
  } catch (e) {
    console.warn("CapturePen area select injection failed:", e);
    showBlocked(tab);
  }
}

async function handleFullPageCapture(tab) {
  if (isRestrictedUrl(tab.url)) { showBlocked(tab); return; }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["full-page-capture.js"]
    });
  } catch (e) {
    console.warn("CapturePen full-page injection failed:", e);
    showBlocked(tab);
  }
}

// ---------- Toolbar icon click: jump straight into area-select mode ----------

chrome.action.onClicked.addListener((tab) => {
  handleAreaCapture(tab);
});

// ---------- Right-click menu on the toolbar icon: other capture modes ----------

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll(); // drop items from older versions
  chrome.contextMenus.create({
    id: "capturepen-capture-visible",
    title: "Capture visible area",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: "capturepen-capture-fullpage",
    title: "Capture full page",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: "capturepen-open-file",
    title: "Edit image from file",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: "capturepen-open-blank",
    title: "Edit screenshot from clipboard",
    contexts: ["action"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "capturepen-capture-visible") handleVisibleCapture(tab);
  if (info.menuItemId === "capturepen-capture-fullpage") handleFullPageCapture(tab);
  if (info.menuItemId === "capturepen-open-file") chrome.tabs.create({ url: chrome.runtime.getURL("editor.html?empty") });
  if (info.menuItemId === "capturepen-open-blank") chrome.tabs.create({ url: chrome.runtime.getURL("editor.html?blank") });
});

// Messages from area-select.js / full-page-capture.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "capture-step") {
    // Used by full-page-capture.js — returns a single visible-area screenshot
    (async () => {
      try {
        const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        const dataUrl = await captureVisible(tab.windowId);
        sendResponse({ ok: true, dataUrl });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.action === "full-page-done") {
    (async () => {
      await storeAndOpenEditor(msg.dataUrl);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.action === "capture-visible") {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      await handleVisibleCapture(tab);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === "capture-area") {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      await handleAreaCapture(tab);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === "area-selected") {
    // area-select.js sends back the crop rect + device pixel ratio;
    // capture the full visible tab, then crop happens in editor
    (async () => {
      // Capture the window the selection came from, not whichever is focused now.
      const tab = sender.tab;
      try {
        const dataUrl = await captureVisible(tab.windowId);
        await chrome.storage.session.set({
          capturepen_image: dataUrl,
          capturepen_crop: msg.rect,
          capturepen_dpr: msg.dpr,
          capturepen_ts: Date.now()
        });
        await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
        sendResponse({ ok: true });
      } catch (e) {
        console.warn("CapturePen area capture failed:", e);
        showBlocked(tab);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
});

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (command === "capture-visible") await handleVisibleCapture(tab);
  if (command === "capture-area") await handleAreaCapture(tab);
});

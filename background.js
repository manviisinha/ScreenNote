// background.js — Service Worker

// ── Helpers ─────────────────────────────────────────────────────────────────
function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('data:') ||
    url.startsWith('file://') // file:// needs extra permission
  );
}

/**
 * Inject content.js + content.css into a tab if not already present,
 * then send it a message. Returns true on success, false on failure.
 */
async function ensureContentScriptAndSend(tabId, message) {
  // Try sending first — if content script is already loaded, this works immediately
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (_) {
    // Content script not loaded — inject it now
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css'],
    });
    // Give the script a moment to initialise
    await new Promise(r => setTimeout(r, 150));
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (err) {
    console.warn(`ScreenNote: could not inject into tab ${tabId}:`, err.message);
    return false;
  }
}

// ── Icon click — toggle annotations on the CLICKED tab only ─────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (isRestrictedUrl(tab.url)) return;

  const data = await chrome.storage.local.get({ screennoteActive: false });
  const nextValue = !data.screennoteActive;
  const action = nextValue ? 'enableAnnotations' : 'disableAnnotations';

  await ensureContentScriptAndSend(tab.id, { action });
  chrome.storage.local.set({ screennoteActive: nextValue });
});

// ── Inject into all existing tabs on install / update ────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!isRestrictedUrl(tab.url)) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content.css'],
        });
      } catch (_) {
        // Tab may not be ready (e.g. still loading) — ignore
      }
    }
  }
});

// ── Show toolbar when user switches tabs (safety net) ────────────────────────
// Guarantees the toolbar appears on any tab the user navigates to,
// as long as screennoteActive is true — even if that tab missed the broadcast.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url)) return;
    const data = await chrome.storage.local.get({ screennoteActive: false });
    if (data.screennoteActive) {
      await ensureContentScriptAndSend(tabId, { action: 'enableAnnotations' });
    }
  } catch (_) {}
});


chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.screennoteActive) {
    const active = changes.screennoteActive.newValue;
    const action = active ? 'enableAnnotations' : 'disableAnnotations';
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (!isRestrictedUrl(tab.url)) {
          // Use ensureContentScriptAndSend so tabs without a loaded content
          // script still get the script injected before the message is sent.
          ensureContentScriptAndSend(tab.id, { action }).catch(() => {});
        }
      });
    });
  }
});

// ── Runtime message handler ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'requestScreenshot') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' })
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(e => sendResponse({ error: e.message }));
    return true; // async
  }


  if (msg.action === 'exitAllTabs') {
    // Clear drawings and disable annotations on every open tab
    chrome.storage.local.set({ screennoteActive: false });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (!isRestrictedUrl(tab.url)) {
          // exitAnnotations clears canvas + hides toolbar (not just hide)
          chrome.tabs.sendMessage(tab.id, { action: 'exitAnnotations' }).catch(() => {});
        }
      });
    });
    sendResponse({ success: true });
    return true;
  }
});

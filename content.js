// content.js — ScreenNote Annotation Engine
(function () {
  // Re-injection guard:
  // Programmatic re-injection (via executeScript) only happens when sendMessage
  // failed — meaning the old content script context is already dead/orphaned.
  // In that case it's always safe to tear down stale DOM and reinitialize.
  // The flag only guards against genuine double-runs (e.g. two rapid injections).
  if (window.__screenNoteLoaded) {
    // Tear down any stale elements left by the orphaned context
    ['screennote-overlay', 'screennote-toolbar', 'screennote-textinput', 'sn-donate-popup']
      .forEach(id => document.getElementById(id)?.remove());
  }
  window.__screenNoteLoaded = true;


  // ── State ───────────────────────────────────────────────────────────────
  let tool = 'pen';
  let color = '#f472b6';
  let size = 4;
  let isDrawing = false;
  let lastX = 0, lastY = 0;
  let startX = 0, startY = 0;
  let strokes = [];        // history for undo
  let redoStack = [];      // history for redo
  let previewCanvas = null;
  let highlightPoints = []; // point list for current highlight stroke
  let hlCanvas = null;      // offscreen canvas for flat highlight rendering
  let mediaRecorder = null;
  let recordedChunks = [];
  let textInput = null;
  let isRecording = false;
  let recordingWithFace = false;
  let captureMicrophone = true;  // mic preference before recording starts
  let micMuted = false;          // real-time mute state during recording
  let micStream = null;          // dedicated mic MediaStream
  let micGainNode = null;        // Web Audio gain node for mic volume
  let recAudioContext = null;    // AudioContext for recording pipeline
  let faceStream = null;
  let faceVideo = null;
  let isDraggingFace = false;
  let faceDragStartX = 0;
  let faceDragStartY = 0;
  let faceInitialLeft = 0;
  let faceInitialTop = 0;

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingFace || !faceVideo) return;
    const dx = e.clientX - faceDragStartX;
    const dy = e.clientY - faceDragStartY;
    const left = Math.min(Math.max(faceInitialLeft + dx, 8), window.innerWidth - faceVideo.offsetWidth - 8);
    const top = Math.min(Math.max(faceInitialTop + dy, 8), window.innerHeight - faceVideo.offsetHeight - 8);
    faceVideo.style.left = `${left}px`;
    faceVideo.style.top = `${top}px`;
    faceVideo.style.right = 'auto';
    faceVideo.style.bottom = 'auto';
  });

  window.addEventListener('mouseup', () => {
    if (!isDraggingFace) return;
    isDraggingFace = false;
    if (faceVideo) faceVideo.style.cursor = 'grab';
  });

  // ── Privacy Mode (Auto-Blur) State & Core Functions ───────────────────────
  let isPrivacyActive = false;
  let privacyObserver = null;
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  function blurEmailsInTextNode(textNode) {
    const text = textNode.nodeValue;
    emailPattern.lastIndex = 0;
    if (!emailPattern.test(text)) return;

    const parent = textNode.parentNode;
    if (!parent) return;

    emailPattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = emailPattern.exec(text)) !== null) {
      const matchIndex = match.index;
      const matchedText = match[0];

      if (matchIndex > lastIndex) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
      }

      const span = document.createElement('span');
      span.className = 'sn-blurred-text';
      span.textContent = matchedText;
      fragment.appendChild(span);

      lastIndex = emailPattern.lastIndex;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    parent.replaceChild(fragment, textNode);
  }

  function scanAndWrapEmails(rootNode = document.body) {
    if (!rootNode) return;

    const walker = document.createTreeWalker(
      rootNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const skipTags = ['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'NOSCRIPT', 'IFRAME'];
          if (
            skipTags.includes(parent.tagName) ||
            parent.closest('.sn-blurred-text') ||
            parent.closest('#screennote-toolbar') ||
            parent.closest('#screennote-overlay')
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          emailPattern.lastIndex = 0;
          if (emailPattern.test(node.nodeValue)) {
            return NodeFilter.FILTER_ACCEPT;
          }

          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    const nodesToProcess = [];
    while (walker.nextNode()) {
      nodesToProcess.push(walker.currentNode);
    }

    nodesToProcess.forEach(node => {
      blurEmailsInTextNode(node);
    });
  }

  function checkInputsInElement(root = document.body) {
    if (!root) return;
    const inputs = root.querySelectorAll ? root.querySelectorAll('input') : [];
    inputs.forEach(input => {
      if (input.type === 'password' || input.type === 'email') {
        input.classList.add('sn-privacy-input');
      } else {
        emailPattern.lastIndex = 0;
        if (emailPattern.test(input.value)) {
          input.classList.add('sn-privacy-input');
        } else {
          input.classList.remove('sn-privacy-input');
        }
      }
    });
  }

  function handlePrivacyInputEvent(e) {
    if (e.target && e.target.tagName === 'INPUT') {
      const input = e.target;
      if (input.type === 'password' || input.type === 'email') {
        input.classList.add('sn-privacy-input');
      } else {
        emailPattern.lastIndex = 0;
        if (emailPattern.test(input.value)) {
          input.classList.add('sn-privacy-input');
        } else {
          input.classList.remove('sn-privacy-input');
        }
      }
    }
  }

  function startPrivacyObserver() {
    if (privacyObserver) return;

    privacyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              scanAndWrapEmails(node);
              checkInputsInElement(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
              const parent = node.parentNode;
              if (parent) {
                const skipTags = ['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'NOSCRIPT', 'IFRAME'];
                if (
                  !skipTags.includes(parent.tagName) &&
                  !parent.closest('.sn-blurred-text') &&
                  !parent.closest('#screennote-toolbar') &&
                  !parent.closest('#screennote-overlay')
                ) {
                  emailPattern.lastIndex = 0;
                  if (emailPattern.test(node.nodeValue)) {
                    blurEmailsInTextNode(node);
                  }
                }
              }
            }
          });
        } else if (mutation.type === 'characterData') {
          const node = mutation.target;
          const parent = node.parentNode;
          if (parent) {
            const skipTags = ['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'NOSCRIPT', 'IFRAME'];
            if (
              !skipTags.includes(parent.tagName) &&
              !parent.closest('.sn-blurred-text') &&
              !parent.closest('#screennote-toolbar') &&
              !parent.closest('#screennote-overlay')
            ) {
              emailPattern.lastIndex = 0;
              if (emailPattern.test(node.nodeValue)) {
                blurEmailsInTextNode(node);
              }
            }
          }
        }
      }
    });

    privacyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function enablePrivacyMode(showToastNotification = true) {
    isPrivacyActive = true;
    document.body.classList.add('sn-privacy-active');

    const blurBtn = toolbar.querySelector('#sn-blur-toggle');
    if (blurBtn) blurBtn.classList.add('active');

    scanAndWrapEmails();
    checkInputsInElement();

    document.addEventListener('input', handlePrivacyInputEvent, true);
    startPrivacyObserver();

    chrome.storage.local.set({ screennotePrivacyActive: true });

    if (showToastNotification) {
      showToast(
        '🔒 Privacy Mode Active',
        'Passwords and email addresses are now automatically blurred on this screen.',
        'info'
      );
    }
  }

  function disablePrivacyMode() {
    isPrivacyActive = false;
    document.body.classList.remove('sn-privacy-active');

    const blurBtn = toolbar.querySelector('#sn-blur-toggle');
    if (blurBtn) blurBtn.classList.remove('active');

    document.removeEventListener('input', handlePrivacyInputEvent, true);
    if (privacyObserver) {
      privacyObserver.disconnect();
      privacyObserver = null;
    }

    document.querySelectorAll('.sn-privacy-input').forEach(input => {
      input.classList.remove('sn-privacy-input');
    });

    chrome.storage.local.set({ screennotePrivacyActive: false });
  }

  // ── DOM Setup ────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'screennote-overlay';
  document.body.appendChild(overlay);

  const canvas = document.createElement('canvas');
  canvas.id = 'screennote-canvas';
  overlay.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // Resize canvas to full page
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    let savedData = null;
    if (canvas.width > 0 && canvas.height > 0) {
      savedData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    
    ctx.scale(dpr, dpr);
    
    if (savedData) {
      // Create a temporary canvas to put the image data and draw it scaled
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = savedData.width;
      tempCanvas.height = savedData.height;
      tempCanvas.getContext('2d').putImageData(savedData, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width / dpr, tempCanvas.height / dpr);
    }
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);


  // Text input
  textInput = document.createElement('input');
  textInput.id = 'screennote-textinput';
  textInput.placeholder = 'Type here...';
  document.body.appendChild(textInput);

  // ── Floating Toolbar ─────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.id = 'screennote-toolbar';
  toolbar.className = 'sn-vertical-panel';
  toolbar.innerHTML = `
    <div class="sn-drag-handle" title="Drag to move">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
    </div>

    <div class="sn-color-picker-wrap">
      <input type="color" id="sn-color-picker" value="#f472b6" title="Choose Color">
    </div>
    
    <div class="sn-size-wrap">
      <input type="range" id="sn-size-slider" min="1" max="20" value="4" title="Stroke Size">
    </div>

    <div class="sn-divider"></div>

    <div class="sn-tools-grid">
      <button class="sn-tool active" data-tool="pen" title="Pen">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      </button>
      <button class="sn-tool" data-tool="highlight" title="Highlighter">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
      </button>
      <button class="sn-tool" data-tool="eraser" title="Eraser">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>
      </button>
      <button class="sn-tool" data-tool="text" title="Text">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
      </button>
      <button class="sn-tool" data-tool="arrow" title="Arrow">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>
      <button class="sn-tool" data-tool="rect" title="Rectangle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
      </button>
      <button class="sn-tool" data-tool="circle" title="Circle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
      </button>
      <button class="sn-tool" id="sn-blur-toggle" title="Auto-Blur Emails & Passwords">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
          <path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
          <line x1="2" x2="22" y1="2" y2="22"/>
        </svg>
        <span class="sn-tool-label">Blur</span>
      </button>
    </div>

    <div class="sn-divider"></div>

    <div class="sn-tools-grid">
      <button class="sn-tool" id="sn-undo" title="Undo (Ctrl+Z)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
      </button>
      <button class="sn-tool" id="sn-redo" title="Redo (Ctrl+Y)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3-2.3"/></svg>
      </button>
      <button class="sn-tool" id="sn-clear" title="Clear All">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>
      <button class="sn-tool" id="sn-save-png" title="Save as PNG">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      </button>
      <button class="sn-tool" id="sn-record-btn" title="Start/Stop Recording">
        <svg id="sn-record-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <button class="sn-tool" id="sn-record-face-btn" title="Record with Face">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3m0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22"/></svg>
      </button>
      <button class="sn-tool" id="sn-mic-toggle" title="Toggle Microphone">
        <svg id="sn-mic-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/><path d="M19 10a7 7 0 0 1-14 0"/><path d="M12 19v4"/><path d="M8 23h8"/></svg>
        <span class="sn-tool-label">MIC</span>
      </button>
      <button class="sn-tool" id="sn-close" title="Exit Annotations">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
      </button>
    </div>

    <button class="sn-donate-btn" id="sn-donate-btn" title="Support ScreenNote (Ko-fi & UPI)">☕ Donate</button>
  `;
  document.body.appendChild(toolbar);

  // ── Donate QR Popup ──────────────────────────────────────────────────────
  const donateBtn = toolbar.querySelector('#sn-donate-btn');
  donateBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    // Remove any existing popup
    const existing = document.getElementById('sn-donate-popup');
    if (existing) { existing.remove(); return; }

    const qrUrl = chrome.runtime.getURL('Donate.jpeg');

    const popup = document.createElement('div');
    popup.id = 'sn-donate-popup';
    popup.innerHTML = `
      <button id="sn-donate-close" title="Close">✕</button>
      <p class="sn-donate-title">☕ Support ScreenNote</p>
      
      <div class="sn-donate-tabs">
        <button class="sn-donate-tab active" data-tab="kofi">Ko-fi / Cards</button>
        <button class="sn-donate-tab" data-tab="upi">UPI Scanner</button>
      </div>

      <div class="sn-donate-content">
        <div class="sn-tab-pane active" id="sn-pane-kofi">
          <p class="sn-donate-sub">Support with Credit Card, PayPal, or UPI globally</p>
          <a href="https://ko-fi.com/manviisinha" target="_blank" class="sn-donate-kofi-link">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sn-kofi-icon">
              <path d="M17 8h1a4 4 0 1 1 0 8h-1"/>
              <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>
              <line x1="6" x2="6" y1="2" y2="4"/>
              <line x1="10" x2="10" y1="2" y2="4"/>
              <line x1="14" x2="14" y1="2" y2="4"/>
            </svg>
            <span>Support on Ko-fi</span>
          </a>
        </div>

        <div class="sn-tab-pane" id="sn-pane-upi">
          <p class="sn-donate-sub">Scan with GPay, PhonePe, or any UPI app</p>
          <img src="${qrUrl}" alt="Donate QR Code" id="sn-donate-qr">
          <p class="sn-donate-upi">manvisinhan4500@oksbi</p>
        </div>
      </div>
    `;
    document.body.appendChild(popup);

    // Tab switcher logic
    const tabs = popup.querySelectorAll('.sn-donate-tab');
    const panes = popup.querySelectorAll('.sn-tab-pane');

    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetTab = tab.dataset.tab;

        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        popup.querySelector(`#sn-pane-${targetTab}`).classList.add('active');
      });
    });

    popup.querySelector('#sn-donate-close').addEventListener('click', (e) => {
      e.stopPropagation();
      popup.remove();
    });

    // Close on outside click
    const closeOnOutside = (e) => {
      if (!popup.contains(e.target) && e.target !== donateBtn) {
        popup.remove();
        document.removeEventListener('click', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside), 10);
  });

  const colorPicker = toolbar.querySelector('#sn-color-picker');
  const sizeSlider = toolbar.querySelector('#sn-size-slider');

  toolbar.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setTool(btn.dataset.tool);
    });
  });

  colorPicker.addEventListener('input', (e) => {
    e.stopPropagation();
    setColor(e.target.value);
  });

  sizeSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    size = parseInt(e.target.value);
  });

  const blurToggle = toolbar.querySelector('#sn-blur-toggle');
  blurToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPrivacyActive) {
      disablePrivacyMode();
    } else {
      enablePrivacyMode();
    }
  });

  toolbar.querySelector('#sn-undo').addEventListener('click', (e) => {
    e.stopPropagation();
    undo();
  });

  toolbar.querySelector('#sn-redo').addEventListener('click', (e) => {
    e.stopPropagation();
    redo();
  });

  toolbar.querySelector('#sn-save-png').addEventListener('click', (e) => {
    e.stopPropagation();
    savePNG();
  });

  toolbar.querySelector('#sn-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    clearAll();
  });

  toolbar.querySelector('#sn-close').addEventListener('click', (e) => {
    e.stopPropagation();
    // Clear local state immediately for this tab
    ctx.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
    strokes = [];
    redoStack = [];
    overlay.classList.remove('active');
    setToolbarVisible(false);
    commitText();
    disablePrivacyMode(); // Ensure privacy mode is turned off immediately on exit
    // Tell background.js to disable annotations on ALL open tabs
    chrome.runtime.sendMessage({ action: 'exitAllTabs' });
  });

  const recBtn = toolbar.querySelector('#sn-record-btn');
  const recIcon = toolbar.querySelector('#sn-record-icon');
  const recFaceBtn = toolbar.querySelector('#sn-record-face-btn');
  const micToggle = toolbar.querySelector('#sn-mic-toggle');
  const micIcon = toolbar.querySelector('#sn-mic-icon');
  
  function updateMicUI(muted) {
    if (muted) {
      micIcon.innerHTML = `
        <path d="M12 1a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/>
        <path d="M19 10a7 7 0 0 1-14 0"/>
        <path d="M12 19v4"/><path d="M8 23h8"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      `;
      micIcon.style.color = '#f87171';
      micToggle.classList.add('sn-mic-muted');
      micToggle.title = 'Unmute Microphone';
    } else {
      micIcon.innerHTML = `
        <path d="M12 1a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/>
        <path d="M19 10a7 7 0 0 1-14 0"/>
        <path d="M12 19v4"/><path d="M8 23h8"/>
      `;
      micIcon.style.color = 'currentColor';
      micToggle.classList.remove('sn-mic-muted');
      micToggle.title = 'Mute Microphone';
    }
  }

  micToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isRecording) {
      // Real-time mute/unmute via track.enabled
      micMuted = !micMuted;
      if (micStream) {
        micStream.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
      }
      updateMicUI(micMuted);
    } else {
      // Toggle pre-recording preference
      captureMicrophone = !captureMicrophone;
      updateMicUI(!captureMicrophone);
    }
  });


  recBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isRecording) {
      recordingWithFace = false;
      startCapture();
      recIcon.style.fill = '#ef4444';
      recIcon.style.color = '#ef4444';
      isRecording = true;
    } else {
      stopCapture();
      recIcon.style.fill = 'none';
      recIcon.style.color = 'currentColor';
      isRecording = false;
    }
  });

  recFaceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isRecording) {
      recordingWithFace = true;
      startCapture();
      recFaceBtn.style.fill = '#ef4444';
      recFaceBtn.style.color = '#ef4444';
      isRecording = true;
    } else {
      stopCapture();
      recFaceBtn.style.fill = 'none';
      recFaceBtn.style.color = 'currentColor';
      isRecording = false;
    }
  });

  function setToolbarVisible(visible) {
    if (visible) {
      toolbar.classList.add('visible');
      toolbar.style.display = 'flex';
    } else {
      toolbar.classList.remove('visible');
      toolbar.style.display = 'none';
    }
  }

  // ── Restore toolbar position & visibility from storage ──────────────────
  chrome.storage.local.get(['screennoteActive', 'screennotePrivacyActive', 'toolbarLeft', 'toolbarTop'], (data) => {
    // Restore saved position if present, removing the CSS centering transform
    if (typeof data.toolbarLeft === 'number' && typeof data.toolbarTop === 'number') {
      toolbar.style.transform = 'none';
      toolbar.style.left = data.toolbarLeft + 'px';
      toolbar.style.top  = data.toolbarTop  + 'px';
    }

    if (data.screennoteActive) {
      // Only show the toolbar — do NOT activate the overlay automatically.
      // Activating overlay on every page load blocks all page interaction;
      // the user can start drawing by clicking a drawing tool.
      setToolbarVisible(true);
    }

    if (data.screennotePrivacyActive) {
      enablePrivacyMode(false);
    }
  });

  // ── React to screennoteActive & screennotePrivacyActive changes directly in content script ──
  // chrome.storage.onChanged fires in ALL content scripts instantly when
  // storage changes — no background.js message round-trip needed.
  // This is the most reliable way to sync toolbar state across all tabs.
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      try {
        if ('screennoteActive' in changes) {
          if (changes.screennoteActive.newValue) {
            setToolbarVisible(true);
          } else {
            overlay.classList.remove('active');
            setToolbarVisible(false);
            commitText();
          }
        }

        if ('screennotePrivacyActive' in changes) {
          const val = changes.screennotePrivacyActive.newValue;
          if (val) {
            enablePrivacyMode(false);
          } else {
            disablePrivacyMode();
          }
        }
      } catch (_) {}
    });
  } catch (_) {}

  // ── Re-show toolbar on tab switch (visibilitychange) ─────────────────────
  // Handles tabs that were already loaded while screennoteActive was true
  // (storage.onChanged won't fire for them — no change occurred).
  // Fires the instant the user switches to this tab, directly in page context.
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      chrome.storage.local.get(['screennoteActive', 'toolbarLeft', 'toolbarTop'], (data) => {
        if (typeof data.toolbarLeft === 'number' && typeof data.toolbarTop === 'number') {
          toolbar.style.transform = 'none';
          toolbar.style.left = data.toolbarLeft + 'px';
          toolbar.style.top  = data.toolbarTop  + 'px';
        }
        if (data.screennoteActive) {
          setToolbarVisible(true);
        } else {
          setToolbarVisible(false);
        }
      });
    });
  } catch (_) {}


  toolbar.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // ── Drag Logic (whole toolbar, click-safe) ───────────────────────────────
  let isDraggingToolbar = false;
  let dragStartX, dragStartY;
  let initialLeft, initialTop;
  let hasMoved = false;
  const DRAG_THRESHOLD = 5; // px — below this it's a click, not a drag

  toolbar.addEventListener('mousedown', (e) => {
    // Don't initiate drag from interactive elements
    if (e.target.closest('button, input, a, select, textarea')) return;
    isDraggingToolbar = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = toolbar.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    toolbar.style.transform = 'none'; // unset the translateY(-50%) so left/top are absolute
    e.stopPropagation();
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingToolbar) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    // Commit drag only once threshold is crossed
    if (!hasMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    hasMoved = true;

    toolbar.classList.add('dragging');
    e.preventDefault();

    const newLeft = Math.min(Math.max(initialLeft + dx, 0), window.innerWidth  - toolbar.offsetWidth);
    const newTop  = Math.min(Math.max(initialTop  + dy, 0), window.innerHeight - toolbar.offsetHeight);
    toolbar.style.left = `${newLeft}px`;
    toolbar.style.top  = `${newTop}px`;
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingToolbar) {
      isDraggingToolbar = false;
      toolbar.classList.remove('dragging');

      // ── Persist toolbar position so it survives tab switches ──────────────
      if (hasMoved) {
        const rect = toolbar.getBoundingClientRect();
        chrome.storage.local.set({
          toolbarLeft: rect.left,
          toolbarTop:  rect.top,
        });
      }
    }
  });

  // ── Tool & Color Setters ─────────────────────────────────────────────────
  function setTool(t) {
    tool = t;
    toolbar.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    const btn = toolbar.querySelector(`[data-tool="${t}"]`);
    if (btn) btn.classList.add('active');

    if (t === 'eraser') {
      overlay.style.cursor = 'cell';
    } else if (t === 'text') {
      overlay.style.cursor = 'text';
    } else {
      overlay.style.cursor = 'crosshair';
    }
  }

  function setColor(c) {
    color = c;
    const picker = toolbar.querySelector('#sn-color-picker');
    if (picker && picker.value !== c) {
      picker.value = c;
    }
  }

  // ── Canvas Drawing ───────────────────────────────────────────────────────
  function saveStroke() {
    const dpr = window.devicePixelRatio || 1;
    strokes.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    redoStack = []; // Clear redo stack when new stroke is made
    if (strokes.length > 50) strokes.shift();
  }

  function undo() {
    if (strokes.length > 0) {
      redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      const lastStroke = strokes.pop();
      ctx.putImageData(lastStroke, 0, 0);
    } else {
      ctx.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
    }
  }

  function redo() {
    if (redoStack.length > 0) {
      strokes.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      const nextState = redoStack.pop();
      ctx.putImageData(nextState, 0, 0);
    }
  }

  function savePNG() {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screennote-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  function clearAll() {
    saveStroke();
    ctx.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
  }

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === textInput) return;

    if (tool === 'text') {
      placeTextInput(e.clientX, e.clientY);
      return;
    }

    isDrawing = true;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;

    if (tool === 'pen' || tool === 'eraser') {
      saveStroke();
      ctx.beginPath();
      ctx.moveTo(startX, startY);
    } else if (tool === 'highlight') {
      saveStroke();
      highlightPoints = [{ x: startX, y: startY }];
      // Prepare/reset offscreen canvas
      if (!hlCanvas) hlCanvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      hlCanvas.width = canvas.width;
      hlCanvas.height = canvas.height;
    } else if (tool === 'rect' || tool === 'circle' || tool === 'arrow') {
      // Save BEFORE drawing so preview can restore here and undo works correctly
      saveStroke();
    }
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const x = e.clientX, y = e.clientY;

    if (tool === 'pen' || tool === 'eraser') {
      ctx.lineTo(x, y);
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (tool === 'eraser') {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = size * 4;
      } else {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = size;
      }
      ctx.stroke();
    } else if (tool === 'highlight') {
      // ── Real highlighter: flat single-alpha stroke via offscreen canvas ──
      highlightPoints.push({ x, y });

      const dpr = window.devicePixelRatio || 1;

      // 1. Restore pre-stroke state so highlight doesn't accumulate
      if (strokes.length > 0) {
        ctx.putImageData(strokes[strokes.length - 1], 0, 0);
      } else {
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      }

      // 2. Draw full stroke on offscreen canvas at full opacity
      const hlCtx = hlCanvas.getContext('2d');
      hlCtx.clearRect(0, 0, hlCanvas.width, hlCanvas.height);
      hlCtx.save();
      hlCtx.scale(dpr, dpr);
      hlCtx.beginPath();
      hlCtx.moveTo(highlightPoints[0].x, highlightPoints[0].y);
      for (let i = 1; i < highlightPoints.length; i++) {
        hlCtx.lineTo(highlightPoints[i].x, highlightPoints[i].y);
      }
      hlCtx.strokeStyle = color;
      hlCtx.lineWidth = size * 6;
      hlCtx.lineCap = 'square';  // flat ends = real marker look
      hlCtx.lineJoin = 'round';
      hlCtx.globalAlpha = 1;
      hlCtx.stroke();
      hlCtx.restore();

      // 3. Composite offscreen stroke onto main canvas at highlight opacity
      ctx.globalAlpha = 0.4;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(hlCanvas, 0, 0, canvas.width / dpr, canvas.height / dpr);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } else if (tool === 'rect' || tool === 'circle' || tool === 'arrow') {
      // Preview: redraw from last saved stroke
      if (strokes.length > 0) {
        ctx.putImageData(strokes[strokes.length - 1], 0, 0);
      } else {
        ctx.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      }
      drawShape(startX, startY, x, y);
    }

    lastX = x;
    lastY = y;
  });

  // Window-level mouseup so isDrawing resets even if mouse released outside overlay
  window.addEventListener('mouseup', (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    const x = e.clientX, y = e.clientY;

    if (tool === 'rect' || tool === 'circle' || tool === 'arrow') {
      // saveStroke() was already called on mousedown — just commit the final shape
      drawShape(startX, startY, x, y);
    } else if (tool === 'highlight') {
      highlightPoints = [];
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
  });

  function drawShape(x1, y1, x2, y2) {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (tool === 'rect') {
      ctx.beginPath();
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (tool === 'circle') {
      const rx = (x2 - x1) / 2;
      const ry = (y2 - y1) / 2;
      ctx.beginPath();
      ctx.ellipse(x1 + rx, y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === 'arrow') {
      drawArrow(x1, y1, x2, y2);
    }
  }

  function drawArrow(x1, y1, x2, y2) {
    const headLen = 16;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  // ── Text Tool ────────────────────────────────────────────────────────────
  function placeTextInput(x, y) {
    // Commit previous text first
    commitText();

    textInput.style.left = x + 'px';
    textInput.style.top = y + 'px';
    textInput.style.color = color;
    textInput.style.borderColor = color;
    textInput.style.fontSize = Math.max(14, size * 3) + 'px';
    textInput.style.display = 'block';
    textInput.value = '';
    textInput.focus();
  }

  function commitText() {
    if (textInput.style.display === 'none' || !textInput.value.trim()) {
      textInput.style.display = 'none';
      return;
    }
    saveStroke();
    const x = parseInt(textInput.style.left);
    const y = parseInt(textInput.style.top);
    const fontSize = parseInt(textInput.style.fontSize);
    ctx.font = `${fontSize}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillText(textInput.value, x, y + fontSize);
    textInput.style.display = 'none';
    textInput.value = '';
  }

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commitText(); e.preventDefault(); }
    if (e.key === 'Escape') { textInput.style.display = 'none'; }
  });

  overlay.addEventListener('click', (e) => {
    if (tool === 'text' && e.target !== textInput) commitText();
  });

  // ── Screen Recording ─────────────────────────────────────────────────────
  let recSeconds = 0;
  let recInterval = null;

  // ── Toast Notifications ───────────────────────────────────────────────────
  function showToast(title, body, type = 'error') {
    const existing = document.getElementById('sn-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'sn-toast';
    toast.className = `sn-toast sn-toast-${type}`;
    toast.innerHTML = `
      <div class="sn-toast-icon">${type === 'error' ? '🚫' : type === 'warning' ? '⚠️' : 'ℹ️'}</div>
      <div class="sn-toast-content">
        <div class="sn-toast-title">${title}</div>
        <div class="sn-toast-body">${body}</div>
      </div>
      <button class="sn-toast-close" title="Dismiss">✕</button>
    `;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add('sn-toast-visible'));

    const dismiss = () => {
      toast.classList.remove('sn-toast-visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    };

    toast.querySelector('.sn-toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, 6000);
  }

  async function startCapture() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: 'screen', frameRate: 30 },
        audio: true
      });

      // Reset audio state
      micStream = null;
      micGainNode = null;
      recAudioContext = null;
      micMuted = !captureMicrophone;

      // ── Collect all tracks for the composite stream ──────────────────────
      const tracks = [...screenStream.getVideoTracks()];

      // System / tab audio tracks (only present if user ticked "Share audio")
      screenStream.getAudioTracks().forEach(t => tracks.push(t));

      // Microphone — separate getUserMedia so it always works independently
      try {
        const rawMicStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
        micStream = rawMicStream;
        // Apply initial mute preference via track.enabled
        rawMicStream.getAudioTracks().forEach(t => {
          t.enabled = !micMuted;
          tracks.push(t);
        });
      } catch (micErr) {
        console.warn('ScreenNote: microphone unavailable', micErr);
        micStream = null;
      }

      const compositeStream = new MediaStream(tracks);

      // If recording with face, get webcam video
      if (recordingWithFace) {
        try {
          faceStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: false
          });

          faceVideo = document.createElement('video');
          faceVideo.id = 'sn-face-preview';
          faceVideo.srcObject = faceStream;
          faceVideo.autoplay = true;
          faceVideo.muted = true;
          faceVideo.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 200px;
            height: 150px;
            border-radius: 12px;
            border: 2px solid #c084fc;
            z-index: 2147483648;
            background: #000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            cursor: grab;
            transform: scaleX(-1);
            object-fit: cover;
          `;
          document.body.appendChild(faceVideo);

          faceVideo.addEventListener('mousedown', (e) => {
            isDraggingFace = true;
            faceDragStartX = e.clientX;
            faceDragStartY = e.clientY;
            const rect = faceVideo.getBoundingClientRect();
            faceInitialLeft = rect.left;
            faceInitialTop = rect.top;
            faceVideo.style.cursor = 'grabbing';
            e.preventDefault();
          });
        } catch (err) {
          console.error('ScreenNote: webcam access failed', err);
          recordingWithFace = false;
        }
      }

      // Update mic button to reflect initial state
      updateMicUI(micMuted);

      // Pick the best MIME type that includes both video + audio codecs
      const mimePreference = [
        'video/webm; codecs=vp9,opus',
        'video/webm; codecs=vp8,opus',
        'video/webm; codecs=opus',
        'video/webm',
      ];
      const mimeType = mimePreference.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(compositeStream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `screennote-${Date.now()}${recordingWithFace ? '-with-face' : ''}.webm`;
        a.click();
        URL.revokeObjectURL(url);

        // Clean up all streams
        screenStream.getTracks().forEach(t => t.stop());
        if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
        if (faceStream) { faceStream.getTracks().forEach(t => t.stop()); faceStream = null; }

        // Remove face preview
        if (faceVideo) { faceVideo.remove(); faceVideo = null; }

        // Reset state
        isRecording = false;
        micMuted = false;
        if (recInterval) { clearInterval(recInterval); recInterval = null; }
        recSeconds = 0;

        // Reset button styles
        if (recIcon) { recIcon.style.fill = 'none'; recIcon.style.color = 'currentColor'; }
        const rfb = toolbar.querySelector('#sn-record-face-btn');
        if (rfb) { rfb.style.fill = 'none'; rfb.style.color = 'currentColor'; }
        updateMicUI(false);
      };

      mediaRecorder.start(1000);
      isRecording = true;
      recSeconds = 0;
      recInterval = window.setInterval(() => { recSeconds += 1; }, 1000);

      // Auto-stop when user ends screen share
      screenStream.getVideoTracks()[0].onended = () => stopCapture();

    } catch (err) {
      console.error('ScreenNote: capture failed', err);
      isRecording = false;

      // Map browser error types to user-friendly messages
      const name = err.name || '';
      const msg = err.message || '';

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        if (msg.toLowerCase().includes('denied') || msg === '') {
          showToast(
            '🚫 Screen access denied',
            'Recording requires permission to share your screen. Please allow it when prompted.',
            'error'
          );
        } else {
          showToast(
            '🔒 This page blocks recording',
            'This page\'s security policy does not allow screen capture. Try on a regular webpage.',
            'error'
          );
        }
      } else if (name === 'AbortError' || name === 'NotReadableError') {
        showToast(
          '❌ Recording cancelled',
          'You closed the screen-share picker without selecting a source.',
          'warning'
        );
      } else if (name === 'NotSupportedError') {
        showToast(
          '⚠️ Not supported here',
          'Screen recording is not supported on this type of page (e.g. browser internal pages, PDF viewer).',
          'error'
        );
      } else if (name === 'SecurityError') {
        showToast(
          '🔒 Blocked by page security',
          'This page\'s Content Security Policy prevents screen recording. Try on a different page.',
          'error'
        );
      } else if (name === 'TypeError') {
        showToast(
          '⚠️ Unsupported browser',
          'Your browser does not support screen recording. Please use Chrome 72+ or Edge 79+.',
          'error'
        );
      } else {
        showToast(
          '⚠️ Recording failed',
          'Could not start recording on this page. Some pages (e.g. chrome://, file://, PDFs) do not allow it.',
          'error'
        );
      }
    }
  }

  function stopCapture() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    const faceVideoEl = document.getElementById('sn-face-preview');
    if (faceVideoEl) faceVideoEl.remove();
    if (faceStream) { faceStream.getTracks().forEach(t => t.stop()); faceStream = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    isRecording = false;
    micMuted = false;
    if (recInterval) { clearInterval(recInterval); recInterval = null; }
    recSeconds = 0;
    setToolbarVisible(true);
    updateMicUI(false);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {

      case 'toggleAnnotations':
        if (overlay.classList.contains('active')) {
          overlay.classList.remove('active');
          setToolbarVisible(false);
          commitText();
        } else {
          overlay.classList.add('active');
          setToolbarVisible(true);
        }
        sendResponse({ success: true });
        break;

      case 'enableAnnotations':
        overlay.classList.add('active');
        setToolbarVisible(true);
        if (msg.tool) setTool(msg.tool);
        if (msg.color) setColor(msg.color);
        if (msg.size) size = msg.size;
        break;

      case 'disableAnnotations':
        overlay.classList.remove('active');
        setToolbarVisible(false);
        commitText();
        break;

      case 'exitAnnotations':
        // Clear canvas + hide toolbar on this tab (triggered from exit button on any tab)
        ctx.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
        strokes = [];
        redoStack = [];
        overlay.classList.remove('active');
        setToolbarVisible(false);
        commitText();
        disablePrivacyMode(); // Ensure privacy mode is turned off on exit
        break;

      case 'updateTool':
        if (msg.tool) setTool(msg.tool);
        if (msg.color) setColor(msg.color);
        if (msg.size) size = msg.size;
        break;

      case 'startCapture':
        startCapture();
        sendResponse({ success: true });
        break;

      case 'stopCapture':
        stopCapture();
        sendResponse({ success: true });
        break;

      case 'undo':
        undo();
        break;

      case 'redo':
        redo();
        break;

      case 'clearAll':
        clearAll();
        break;
    }
  });

  // Keyboard shortcuts when annotating
  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('active')) return;
    // Don't steal keypresses from any focusable / editable element on the host page
    const active = document.activeElement;
    if (active && (active === textInput ||
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable)) return;

    if (e.ctrlKey && e.key === 'z') { undo(); e.preventDefault(); }
    if (e.ctrlKey && e.key === 'y') { redo(); e.preventDefault(); }
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key === 'p') setTool('pen');
      if (e.key === 'a') setTool('arrow');
      if (e.key === 'r') setTool('rect');
      if (e.key === 't') setTool('text');
      if (e.key === 'h') setTool('highlight');
      if (e.key === 'e') setTool('eraser');
      if (e.key === 's') savePNG();
      if (e.key === 'm' || e.key === 'M') micToggle.click();
    }
    if (e.key === 'Escape') {
      overlay.classList.remove('active');
      setToolbarVisible(false);
    }
  });

})();

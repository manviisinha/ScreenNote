# ScreenNote — Record & Annotate

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge%20%7C%20Brave-blue.svg)](#)
[![Manifest](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](#)
[![Tech](https://img.shields.io/badge/Tech-Vanilla%20JS%20%7C%20WebRTC%20%7C%20Canvas%202D-orange.svg)](#)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install%20Now-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/hmedeanfffglpfpbhkonnidmlgjgmopp?utm_source=item-share-cb)

**A zero-install, browser-native Chrome extension that combines pro-grade screen annotations, HD screen recording, microphone capture, and picture-in-picture webcam streaming into a single, lightweight tool.**

</div>

---

## 💡 What Problem Does ScreenNote Solve?

### 1. Annotation + Recording in One Place
Most free tools do only one thing — draw *or* record. Getting both in one place usually means paying for a premium app. ScreenNote gives you drawing tools, screen recording, microphone capture, and a draggable facecam overlay — completely free and open source.

### 2. Zero Disk Bloat
Desktop recorders (OBS, Camtasia) install gigabytes of software and cache raw footage to your drive. ScreenNote runs entirely inside Chrome's sandbox with **no installation, no background services, and no cached files**. Recordings are encoded on-the-fly as lightweight `.webm` files and saved straight to your Downloads folder.

### 3. The Educator's Digital Chalkboard
Draw arrows, highlight formulas, type inline annotations, and record your screen — all while your webcam bubble floats alongside so students stay connected. Works on any webpage: PDFs, slides, docs, dashboards.

---

## 🌟 Features

| Feature | Details |
|---|---|
| ✏️ **Pen** | Freehand drawing with adjustable size & color |
| 🖊️ **Highlighter** | Flat marker effect with no alpha accumulation |
| ➡️ **Arrow** | Straight arrows pointing to any element |
| ▭ **Rectangle** | Outline boxes with live preview |
| ⭕ **Circle / Ellipse** | Draw ellipses with live preview |
| **T Text** | Click anywhere to type; commits to canvas on Enter |
| 🧹 **Eraser** | Pixel-precise destination-out erasing |
| ↩️ **Undo / Redo** | 50-step canvas history |
| 💾 **Save PNG** | Download the current canvas as a transparent PNG |
| 🎥 **Screen Recording** | HD WebRTC capture, VP9+Opus, auto-saves `.webm` |
| 🙂 **Facecam (PiP)** | Draggable webcam overlay during recording |
| 🎙️ **Mic Toggle** | Real-time mute/unmute during recording |
| 🎨 **Color Picker** | Full color wheel for all drawing tools |
| 📐 **Size Slider** | Adjust stroke width (1–20 px) |
| 🔄 **Persistent Toolbar** | Remembers position and active state across tabs |
| ⌨️ **Keyboard Shortcuts** | Full hotkey set for every tool |
| ☕ **Donate** | Ko-fi link + UPI QR code built right in |

---

## 🌐 Install from the Chrome Web Store

> **The easiest way to get ScreenNote** — no developer mode, no unzipping, no setup.

<div align="center">

<a href="https://chromewebstore.google.com/detail/hmedeanfffglpfpbhkonnidmlgjgmopp?utm_source=item-share-cb">
  <img src="https://img.shields.io/badge/%F0%9F%9A%80%20Install%20ScreenNote-Chrome%20Web%20Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install on Chrome" />
</a>

</div>

<br/>

<div align="center">

| 🔒 Zero permissions abuse | ⚡ Instant activation | 🆓 Completely free | 🔄 Auto-updates |
|:---:|:---:|:---:|:---:|
| Only what's needed | Works right after install | No hidden fees | Always the latest version |

</div>

👉 **[Click here to install ScreenNote →](https://chromewebstore.google.com/detail/hmedeanfffglpfpbhkonnidmlgjgmopp?utm_source=item-share-cb)**

If you enjoy using it, please consider ⭐ **leaving a review** on the store — it helps others discover ScreenNote!

---

## 🚀 Installation (Developer Mode)

> Prefer to load it yourself? Use developer mode:

1. **Clone / Download** this repository.
2. Open **`chrome://extensions/`** in Chrome, Edge, or Brave.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `screen-annotator-extension` folder (the one containing `manifest.json`).
5. Click the puzzle icon in the Chrome toolbar and **pin ScreenNote** for one-click access.

---

## ⌨️ Keyboard Shortcuts

> Shortcuts only fire when the annotation overlay is active and no input field on the page has focus.

| Shortcut | Action |
|---|---|
| `P` | Pen tool |
| `H` | Highlighter |
| `E` | Eraser |
| `T` | Text tool |
| `A` | Arrow tool |
| `R` | Rectangle tool |
| `S` | Save PNG snapshot |
| `M` | Toggle microphone mute |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` | Redo |
| `Esc` | Hide toolbar & deactivate overlay |

---

## 🏗️ Architecture

```
screen-annotator-extension/
├── manifest.json       # Manifest V3 — permissions, icons, CSP
├── background.js       # Service worker — tab management, injection, messaging
├── content.js          # Annotation engine — canvas, toolbar, recording
├── content.css         # All UI styles — toolbar, toasts, donate popup
├── Donate.jpeg         # UPI QR code image
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Key Implementation Details

**1. Highlighter Without Alpha Bleed**
Drawing with `globalAlpha < 1` on a canvas causes overlapping strokes to darken at intersections. ScreenNote fixes this by rendering the full highlight stroke onto an offscreen canvas at `globalAlpha = 1`, then compositing it onto the main canvas *once* at `0.4` opacity — giving a clean, flat marker look.

**2. Cross-Tab Sync via `chrome.storage.onChanged`**
Instead of round-trip background messages, content scripts listen directly to `chrome.storage.onChanged`. The instant the toolbar state changes on any tab, every other tab reacts immediately — no polling, no delay.

**3. Orphaned Context Guard**
When an extension is reloaded mid-session, old DOM elements remain on the page. ScreenNote detects this via `window.__screenNoteLoaded` and tears down stale elements before re-initializing, preventing duplicate overlays.

**4. High-DPI Canvas**
Canvas dimensions are scaled by `window.devicePixelRatio`. On resize, pixel data is backed up, the canvas is resized and re-scaled, then the saved data is restored — keeping annotations sharp on all displays.

**5. Composite Audio Stream**
Screen audio (if shared by the user) and microphone audio are merged into a single `MediaStream` before being passed to `MediaRecorder`. Real-time mute works by toggling `track.enabled` on the mic audio track — no need to restart the recorder.

---

## 🔒 Security & Privacy

- **Zero server-side code.** No backend. No cloud. No accounts.
- **No telemetry or analytics** of any kind.
- **All media stays local.** Recordings, snapshots, and webcam feeds never leave your machine.
- **Offline capable.** All tools work without an internet connection.
- **Manifest V3** — uses the latest, most security-constrained extension architecture.
- **Minimal permissions** — only `activeTab`, `scripting`, `storage`, and `tabCapture`.

---

## 🤝 Contributing

Contributions are welcome! Whether it's a bug fix, a new tool, or a UX improvement:

1. Fork the repository.
2. Make changes to `content.js`, `content.css`, `background.js`, or `manifest.json`.
3. Test locally in Chrome Developer Mode.
4. Open a Pull Request with a clear description of what changed and why.

Please keep the codebase framework-free (vanilla JS only) and avoid adding new permissions without a strong reason.

---

## ☕ Support

If ScreenNote has saved you time or made your presentations better, consider supporting development:

- **Ko-fi:** [ko-fi.com/manviisinha](https://ko-fi.com/manviisinha) — Credit card, PayPal, or global UPI
- **UPI:** `manvisinhan4500@oksbi` — Scan the QR code inside the extension

---

## 📜 License

MIT License — see [LICENSE](LICENSE) for details.

*Crafted with ❤️ for teachers, learners, and builders by [@manviisinha](https://github.com/manviisinha).*

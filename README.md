# ScreenNote — Record & Annotate

ScreenNote is a powerful, lightweight Chrome extension that allows you to draw, highlight, and write directly on any webpage while recording your screen and audio. Perfect for tutorials, presentations, feedback, and more!

## ✨ Features

- **Draw & Annotate Anywhere:** Use a variety of tools (Pen, Highlighter, Eraser, Text, Arrow, Rectangle, Circle) to annotate directly on the current webpage.
- **Persistent Toolbar:** The annotation toolbar stays with you across all tabs. You can drag it to any position, and it remembers exactly where you put it, even when you switch tabs or reload the page!
- **Cross-Tab Synchronization:** Turn on annotations in one tab, and they become instantly available across all your open tabs. Click "Exit Annotations" and it perfectly cleans up your drawings and closes the toolbar everywhere.
- **Screen & Audio Recording:** Record your screen (entire screen, window, or tab) along with your microphone.
- **Webcam / Face Recording:** Optionally include a floating, draggable webcam preview in your recordings for a personal touch.
- **Real-time Mic Toggle:** Mute and unmute your microphone on the fly while recording.
- **Undo / Redo / Clear:** Full history control for your drawings.
- **Save as PNG:** Take a quick snapshot of your annotated screen.
- **Donate Support:** Includes a sleek QR code popup for easy donations via GPay or any UPI app.

## 🚀 Installation (Developer Mode)

Since this extension is loaded locally:

1. Open Google Chrome or Microsoft Edge.
2. Navigate to the extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Enable **"Developer mode"** (usually a toggle in the top right corner).
4. Click on **"Load unpacked"**.
5. Select the `screen-annotator-extension` folder (the directory containing `manifest.json`).
6. The ScreenNote extension icon should now appear in your browser's toolbar!

## 💡 How to Use

1. **Start Annotating:** Click the ScreenNote icon in your browser toolbar to activate the extension. A floating toolbar will appear on the left side of your screen.
2. **Move the Toolbar:** Click and drag the top handle (the dotted grip) to move the toolbar anywhere on your screen. It will remember this position across all tabs!
3. **Select Tools:** Choose your preferred color, brush size, and tool (Pen, Highlight, Text, Shapes, etc.).
4. **Draw:** Click and drag on the webpage to draw.
5. **Switch Tabs:** Switch freely between tabs; your toolbar will follow you and remember its position.
6. **Record:** 
   - Click the **Record** icon (circle) to start recording your screen.
   - Click the **Face Record** icon to record with a draggable webcam view.
   - Click the **Mic** icon to toggle your microphone anytime.
   - Click the Record icon again to stop and automatically download the `.webm` video.
7. **Exit:** Click the **Close** (X) button at the bottom of the toolbar to instantly clear all drawings and hide the toolbar across **all** your open tabs.

## 🛠️ Recent Technical Improvements

- **Robust Cross-Tab Sync:** Uses both `chrome.storage.onChanged` in content scripts and `visibilitychange` events to ensure the toolbar instantly appears and hides across all tabs without background script delays.
- **Smart Position Persistence:** Toolbar coordinates are saved to local storage on `mouseup` after dragging, ensuring perfect placement restoration on tab switches and page reloads.
- **Orphaned Context Handling:** Smart detection and teardown of stale DOM elements if the extension is reloaded or updated, preventing broken state.
- **Global Exit:** The "Exit Annotations" button now broadcasts an `exitAnnotations` command to clear the canvas (`ctx.clearRect`) and wipe undo/redo history arrays on every single tab, ensuring no ghost drawings are left behind.
- **Glassmorphism UI:** Updated sleek, modern UI with blurred backgrounds and smooth transitions for the toolbar and toast notifications.
- **QR Donation Popup:** Integrated a custom UI popup to display a donation QR code directly over the page.

## 📁 File Structure

- `manifest.json`: Extension configuration and permissions (MV3).
- `background.js`: Service worker handling global state, cross-tab messaging, and installation events.
- `content.js`: The core engine injected into pages. Handles the canvas, drawing logic, recording API, UI interactions, and state sync.
- `content.css`: Styling for the canvas overlay, floating toolbar, toast notifications, and modals.
- `icons/`: Contains the extension icons.
- `Donate.jpeg`: The QR code image for the donation popup.

---
*Built with ❤️ for better visual communication.*

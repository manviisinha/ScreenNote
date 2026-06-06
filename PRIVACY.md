# Privacy Policy for ScreenNote — Record & Annotate

**Effective Date:** June 6, 2026  
**Last Updated:** June 6, 2026

## 1. Introduction and Core Philosophy
Welcome to **ScreenNote — Record & Annotate** ("we," "our," or "the Extension"). We believe that your privacy is a fundamental human right. Our extension was designed from the ground up with a strict **Privacy-by-Design** and **Zero-Data-Collection** architecture. 

This Privacy Policy details how our extension interacts with your browser, what local permissions it requires, and how we guarantee the absolute security and privacy of your screen recordings and annotations.

## 2. What Data We Do NOT Collect
To put it simply: **We do not collect, transmit, store, or sell any of your personal data.** 

Because the extension operates entirely locally on your device, we **do not** collect or have access to:
- **Personally Identifiable Information (PII):** We do not ask for your name, email, IP address, or any other identifying data.
- **Web History & Analytics:** We do not track which websites you visit or monitor your browsing behavior.
- **Screen Recordings & Annotations:** We never upload your video files, screenshots, or drawings to our servers or any third-party cloud.
- **Telemetry & Crash Reports:** We do not use background analytics trackers or crash reporting tools that might inadvertently leak your usage data.

## 3. How Your Data is Secured (Local-Only Architecture)
Our extension is 100% client-side. This means that every single line of code executes locally on your personal computer within your Chrome browser. 

**Uncompromising Security Guarantees:**
- **Local Processing:** When you draw on the screen, highlight text, or record a video, all processing is done entirely by your computer's CPU and memory. 
- **Local Saving:** The resulting screenshot or video file is generated directly inside your browser and downloaded straight to your local hard drive. Your files never touch the internet.
- **No Remote Servers:** We do not maintain any API servers, databases, or cloud storage buckets for this extension. It is physically impossible for us to access your recordings or drawings, making the extension completely immune to server-side data breaches.

## 4. Required Chrome Permissions Explained
To function properly, the extension requests the following permissions from your browser. These are used *only* to power the local functionality of the tool on your machine:

- **`activeTab` & Host Permissions (`<all_urls>`):** 
  - *Why we need it:* To inject the transparent drawing canvas and user interface toolbar over the website you are currently viewing. It also allows us to capture the screen layout when you take a screenshot.
  - *Security note:* We only inject these tools when you explicitly click the extension icon to start an annotation session. We do not read the contents of the page in the background.
- **`scripting`:** 
  - *Why we need it:* To programmatically execute our local JavaScript (`content.js`) and CSS (`content.css`) files on the active tab without requiring a page reload.
- **`storage`:** 
  - *Why we need it:* To remember your local tool preferences (like your favorite drawing color, brush size, or privacy toggles) using `chrome.storage.local`. 
  - *Security note:* This data is stored locally on your hard drive and is never synced to the cloud or shared with anyone.
- **`tabCapture` / Screen Recording:** 
  - *Why we need it:* To capture the video and audio stream of your active tab so you can record your screencasts. 
  - *Security note:* The generated video blob is immediately handed back to you as a local download.

## 5. Third-Party Services
We do not use any third-party services. There are no Google Analytics, no Facebook Pixels, and no ad trackers bundled into our extension. The code is entirely self-contained.

## 6. Children's Privacy
Because our extension operates entirely locally and collects zero personal data, it is inherently safe for users of all ages, including children under the age of 13. We do not knowingly (or unknowingly) collect any information from anyone.

## 7. Your Rights and Control
Since we do not hold any of your data, you are always in complete control. 
- **To delete your data:** Simply uninstall the extension from your browser. This will instantly erase any saved local preferences.
- **To restrict access:** You can toggle the extension off or restrict its site access at any time through Chrome's Extension Management page (`chrome://extensions/`).

## 8. Open Source & Transparency
We believe that absolute security requires transparency. If you are a developer, a privacy advocate, or a security researcher, you are welcome to inspect our bundled source code directly. You will see that there are no hidden network requests or data exfiltration methods.

## 9. Contact Us
If you have any questions, security concerns, or require further clarification about our robust privacy practices, please contact the developer directly by opening an issue on our [GitHub Repository](https://github.com/manviisinha/ScreenNote).

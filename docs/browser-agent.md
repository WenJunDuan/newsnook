# NewsNook Browser Agent

Android-only AI automation for the **existing** NewsNook browser WebView. It does not access or control other Android apps, Accessibility Services, ADB, or a second browser engine.

## Setup

1. Open NewsNook's built-in browser and load a web page.
2. Tap **AI 浏览助手** in the browser toolbar (also available under **网页工具**).
3. Open **API 设置** and provide **Base URL**, **Model**, and **API Key**. The endpoint must implement OpenAI-compatible `POST /chat/completions`, including a text `choices[0].message.content` response containing a JSON action. For visual fallback, use a vision-capable model.
4. Normally use HTTPS. Localhost HTTP is allowed. Private LAN HTTP (RFC1918 or `.local`/`.lan`) requires explicitly enabling **允许局域网 HTTP**. Its API key is transmitted unencrypted over that connection. Public HTTP endpoints are rejected.
5. Enter a task and select **开始任务**. **停止** aborts further actions. Consequential interactions (publication, deletion, payment, sending content, unlabeled buttons, unknown visual clicks) pause for explicit confirmation.

API key persistence uses the existing Android SecureStore / Keystore. Base URL, model, and LAN opt-in are saved separately. This browser feature has no NewsNook AI relay server. Current page text, permitted page element metadata, and screenshots (if requested) are supplied to the user-configured model endpoint.

## Architecture

- `BrowserHostPlugin.agentAction`: tab-scoped and navigation-aware native controller, screenshot + actual WebView touch, no bridge exposed to remote websites.
- `android/app/src/main/assets/browser-agent.js`: DOM observation, visible-text extraction, stable observation snapshots, input/click/dropdown/submit/scroll.
- `browserAgent.ts`: endpoint policy, BYOK settings, model step parser, API calls and confirmation policy.
- `BrowserAgentPanel.tsx`: observable step loop, 35-step bound, stop/cancel, confirmation, task results.

## Verification

- `npm run test:browser-agent` — DOM snapshot expiration, policy and parser.
- `npm run test:browser` — full existing browser regression plus Agent tests.
- `npm run build`, `npx cap sync android`, `cd android && ./gradlew :app:assembleLocalDebug` — production assets and native debug APK.
- `scripts/browser-agent-device-smoke.mjs` — requires an isolated emulator with the debug APK installed and ADB DevTools forwarded to port 9231; verifies real WebView observe/input/click/navigation/screenshot/tap/scroll.
- `scripts/browser-agent-ui-smoke.mjs` — same emulator, test-only local HTTP fixture on port 8765 plus ADB reverse; checks BYOK, Keystore, simulated Chat Completions, autonomous tools, confirmation/denial and task abort. Tests never require a real API key and clean up test credentials.

**Test scope:** The E2E fixture verifies the complete client/model/browser control chain. A real third-party model endpoint has not been tested without a user-provided API key. Site-specific login, CAPTCHA, and complex cross-origin iframe behavior remain dependent on the website's WebView compatibility.

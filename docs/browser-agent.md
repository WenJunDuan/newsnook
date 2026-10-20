# NewsNook AI Browser Agent (ReAct)

Only controls the **existing NewsNook Android browser WebView**. It does not require Accessibility Services, system permissions, ADB, another browser kernel, or a backend account.

## How to use

1. Open **NewsNook browser**. You **do not need to open a page first**.
2. Tap **AI 浏览助手** in the toolbar. In **API 设置**, enter the **Base URL**, **Model**, and **API Key** (OpenAI-compatible Chat Completions **function/tool calling** is required; a vision-capable model enables screenshot mode). Save the settings.
3. Give a **single natural-language instruction** (e.g., “去 Linux.do 找到讨论 Qwen 量化的帖子，阅读并总结推荐选择”) and select **开始任务**.
4. The model decides how to proceed: search with the user's selected search engine, navigate to a known URL, observe the current page, enter text, click, scroll, switch tabs, request a screenshot, or finish. Each tool's *actual browser result* is returned to the model for its next decision. **No fixed action plan, no pre-selected step order, and no current-page prerequisite.**
5. **停止** prevents further actions; potentially consequential browser interactions pause for one-time approval.

Only the API key is saved to the existing Android SecureStore / Keystore. Model, endpoint and LAN opt-in are stored separately. HTTPS is default; opt-in private LAN HTTP is available for local models and sends the API key in plaintext on that LAN. No NewsNook AI relay server is used. Page text and screenshots requested by the model are sent to the configured API endpoint.

## ReAct implementation

- `browserAgent.ts`: model-native OpenAI-compatible `tools`/`tool_calls` with `tool_choice:auto`, dynamic tool selection and feedback, paired assistant/tool messages, model final text response, context bounds, circuit breaker (64 tool calls), cancellation. No single-step JSON action parser in the execution loop.
- `BrowserAgentPanel.tsx`: user goal, secure settings, browser-side tool executor using current browser session, automatic post-action observations, app-theme UI, progress, stop, and sensitive-action confirmation. Starts on a blank browser page.
- `BrowserHostPlugin.agentAction` / `browser-agent.js`: screenshot, physical WebView taps, DOM observation with snapshot epoch IDs, text, input, click, select, submit, long-page scroll.
- Available model tools: `browser_search`, `browser_open_url`, `browser_observe`, `browser_click`, `browser_type`, `browser_choose`, `browser_submit`, `browser_scroll`, `browser_back`, `browser_forward`, `browser_tabs`, `browser_new_tab`, `browser_switch_tab`, `browser_close_tab`, `browser_screenshot`, `browser_tap`.

## Verification

- `npm run test:browser-agent` — DOM snapshot integrity, endpoint and approval policies, ReAct schema, action selection, result feedback, error recovery, cancellation.
- `npm run test:browser` — full existing browser regression suite plus Agent tests.
- `npm run build`, `npx cap sync android`, `cd android && ./gradlew :app:assembleLocalDebug` — Android debug APK.
- `scripts/browser-agent-device-smoke.mjs` — isolated emulator with ADB DevTools forwarded to TCP 9231; native WebView operations.
- `scripts/browser-agent-ui-smoke.mjs` — same emulator, test-only fixture port 8765 with ADB reverse; verifies **from a blank browser** BYOK, Keystore, model-native tool calls, tool observation loop, typing/clicking, tabs, dropdowns, screenshot and touch, approvals and cancellation. It does not need a real provider API key and erases test credentials afterward.

**Compatibility:** Third-party Chat Completions providers must support the OpenAI `tools`/`tool_calls` protocol. Models that only emit JSON text are insufficient for this ReAct flow. Real external-model compatibility depends on the chosen provider. Automated E2E tests use a local simulated model with actual Android WebView and the real native bridge.

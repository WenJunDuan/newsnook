---
doc_type: decision
slug: api-cleartext-http
created: "2026-08-24"
sprint_slug: ""
status: accepted
deciders: ["user", "Grok"]
---

# Decision: api-cleartext-http

## 背景 (context)

AI 智读 / 云端翻译曾强制 API 地址 HTTPS，文案为「为保护 API Key，API 地址必须使用 HTTPS」。用户要接本地模型（Ollama / LM Studio 等多为 HTTP），随后明确公网 HTTP 也允许，「不用这么严格」。

## 选项 (options considered)

### 选项 A: 仅本机/局域网允许 HTTP
- ✅ 公网 Key 仍走 TLS
- ❌ 自建 HTTP 网关、内网 IP 直出仍被拦

### 选项 B: 任意主机 HTTP 与 HTTPS 均可（采纳）
- ✅ 本地模型、自建反代、无证书环境都能填
- ❌ 公网明文可能泄露 Key；由用户自担

### 选项 C: 保持强制 HTTPS
- ❌ 用户明确否决

## 决定 (decision)

采纳 B。校验只拒绝非 `http:`/`https:` 协议。实现：`src/lib/apiEndpoint.ts` 的 `assertHttpApiEndpoint`，翻译与 AI 客户端共用。

## 权衡 (trade-offs)

接受公网 HTTP 的明文风险，换取本地/自建接口可用性。不在客户端做证书钉扎或混合内容绕过。

## 影响 (consequences)

- 对本次: 已合入工作区，设置页提示 HTTP 与 HTTPS 均可
- 对后续: 不要再加「公网必须 HTTPS」门禁，除非用户改口
- 对 architecture/: 无新子系统；属接口配置约束

export const API_ENDPOINT_PROTOCOL_REQUIRED = 'API 地址仅支持 HTTP 或 HTTPS'

/**
 * 允许任意主机的 HTTP / HTTPS；拒绝 ftp 等其它协议。
 *
 * @throws 协议不是 http: 或 https:
 */
export function assertHttpApiEndpoint(parsed: URL): void {
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return
  throw new Error(API_ENDPOINT_PROTOCOL_REQUIRED)
}

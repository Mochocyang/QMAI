/** 接口可能回显请求字段；展示前移除已知密钥和常见认证内容。 */
export function safeModelError(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : typeof error === "string" ? error : "操作失败，请检查配置后重试。"
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const value of [secret, encodeURIComponent(secret)]) message = message.split(value).join("[已隐藏]")
  }
  return message
    .replace(/(Authorization\s*[:=]\s*(?:Bearer|Basic)?\s*)[^\s,;"']+/gi, "$1[已隐藏]")
    .replace(/([?&](?:api[_-]?key|key|token|access[_-]?token|secret)=)[^\s&#]+/gi, "$1[已隐藏]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[已隐藏]@")
    .slice(0, 1500)
}

export function validateModelEndpoint(value: string): string | null {
  if (!value.trim()) return "请填写接口地址。"
  try {
    const url = new URL(value.trim())
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return "接口地址必须以 http:// 或 https:// 开头。"
    if (url.username || url.password) return "接口地址不能包含账号或密码，请使用单独的 API 密钥字段。"
    return null
  } catch { return "接口地址格式不正确，请填写完整的 http:// 或 https:// 地址。" }
}

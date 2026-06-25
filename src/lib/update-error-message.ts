export function formatUpdateErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)

  if (raw.includes("Could not fetch a valid release JSON from the remote")) {
    return "检查更新失败：没有从更新服务器拿到有效的版本信息。请先确认网络可以访问 GitHub，若未启用代理请关闭系统或软件代理后重试。"
  }

  if (raw.trim()) {
    return `检查更新失败：${raw}`
  }

  return "检查更新失败：请稍后重试。"
}

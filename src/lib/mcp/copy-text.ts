export function buildMcpConfigInstallText(executablePath: string): string {
  return [
    "请把青幕写作 MCP 加入当前 agent 的 MCP 配置（服务名 qmai，已有同名则覆盖），然后重新加载 MCP。",
    "",
    "启动命令：",
    `"${executablePath}" --mcp-stdio`,
    "",
    "应用需保持打开，并且设置里的 MCP 开关已打开。",
  ].join("\n")
}

export function buildAgentInstallText(executablePath: string, skillDir: string, version: string): string {
  return `${buildMcpConfigInstallText(executablePath)}\n\n${buildSkillInstallText(skillDir, version)}`
}

export function buildSkillInstallText(skillDir: string, version: string): string {
  return [
    `请安装 qmai-mcp ${version}：将以下路径的目录整份复制到当前 agent 的 skills 目录（覆盖已有同名目录），然后重新加载 skill。`,
    "",
    skillDir,
  ].join("\n")
}

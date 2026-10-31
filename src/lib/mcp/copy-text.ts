export function buildMcpConfigInstallText(executablePath: string): string {
  return JSON.stringify({
    mcpServers: {
      qmai: {
        command: executablePath,
        args: ["--mcp-stdio"],
      },
    },
  }, null, 2)
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

import { invoke } from "@tauri-apps/api/core"
import { readFile } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { isTauri } from "@/lib/platform"
import { loadMcpSettings, type McpSettings } from "@/lib/project-store"
import { parseSkillVersion, type SkillSyncReport } from "./skill-sync"
import { startMcpHost } from "./host"

export async function syncInstalledQmaiMcpSkill(agentSkillsDir: string): Promise<SkillSyncReport> {
  if (!agentSkillsDir.trim()) return { status: "skipped", message: "未填写 Agent skills 目录" }
  if (!isTauri()) return { status: "skipped", message: "当前环境不能更新 skill" }
  const bundledDir = await invoke<string>("resolve_qmai_mcp_skill_dir")
  const { syncQmaiMcpSkill, createTauriSkillSyncIo } = await import("./skill-sync")
  return syncQmaiMcpSkill({
    bundledDir,
    agentSkillsDir,
    io: createTauriSkillSyncIo(),
  })
}

export async function readBundledSkillInstallInfo(): Promise<{ skillDir: string; version: string; executablePath: string }> {
  const [skillDir, executablePath] = await Promise.all([
    invoke<string>("resolve_qmai_mcp_skill_dir"),
    invoke<string>("mcp_stdio_executable"),
  ])
  const version = parseSkillVersion(await readFile(joinPath(skillDir, "SKILL.md"))) ?? ""
  if (!version) throw new Error("随包 skill 没有可用的版本号")
  return { skillDir, version, executablePath }
}

export async function bootMcp(): Promise<() => void> {
  const stop = await startMcpHost()
  if (!isTauri()) return stop
  const settings = await loadMcpSettings().catch(() => ({ enabled: false, agentSkillsDir: "" }))
  if (settings.enabled) {
    await invoke("mcp_set_enabled", { enabled: true }).catch((error) => {
      console.warn("[mcp] 启动失败：", error)
    })
  }
  if (settings.agentSkillsDir) {
    await syncInstalledQmaiMcpSkill(settings.agentSkillsDir).catch((error) => {
      console.warn("[mcp] skill 自检失败：", error)
    })
  }
  return stop
}

export async function applyMcpSettings(settings: McpSettings): Promise<SkillSyncReport> {
  await invoke("mcp_set_enabled", { enabled: settings.enabled })
  return syncInstalledQmaiMcpSkill(settings.agentSkillsDir)
}

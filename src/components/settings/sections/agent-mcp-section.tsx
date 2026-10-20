import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { copyDirectory, createDirectory, deleteFile, fileExists } from "@/commands/fs"
import { buildMcpConfigInstallText, buildSkillInstallText } from "@/lib/mcp/copy-text"
import { applyMcpSettings, readBundledSkillInstallInfo } from "@/lib/mcp/startup"
import { openExternalUrl } from "@/lib/open-external-url"
import { pickDirectory } from "@/lib/platform"
import { joinPath } from "@/lib/path-utils"
import { loadMcpSettings, saveMcpSettings } from "@/lib/project-store"

const MCP_DOC_URL = "https://github.com/Mochocyang/QMAI/blob/cursor/mcp-agent-tools-f62a/docs/mcp-agent-tools-%E5%88%86%E6%94%AF%E8%AF%B4%E6%98%8E.md"

interface InstallInfo {
  skillDir: string
  version: string
  executablePath: string
}

export function AgentMcpSection() {
  const [enabled, setEnabled] = useState(false)
  const [port, setPort] = useState<number | null>(null)
  const [install, setInstall] = useState<InstallInfo | null>(null)
  const [notice, setNotice] = useState("")

  useEffect(() => {
    let cancelled = false
    void loadMcpSettings()
      .then(async (settings) => {
        if (cancelled) return
        setEnabled(settings.enabled)
        if (settings.enabled) await refreshPort()
      })
      .catch((cause) => {
        if (!cancelled) setNotice(cause instanceof Error ? cause.message : String(cause))
      })
    void readBundledSkillInstallInfo()
      .then((info) => {
        if (!cancelled) setInstall(info)
      })
      .catch((cause) => {
        if (!cancelled) setNotice(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function refreshPort() {
    try {
      const status = await invoke<{ enabled: boolean; port: number | null }>("mcp_status")
      setPort(status.port)
    } catch {
      setPort(null)
    }
  }

  async function toggle() {
    const next = !enabled
    setEnabled(next)
    setNotice("")
    try {
      const current = await loadMcpSettings()
      const settings = { enabled: next, agentSkillsDir: current.agentSkillsDir }
      await saveMcpSettings(settings)
      await applyMcpSettings(settings)
      if (next) await refreshPort()
      else setPort(null)
    } catch (cause) {
      setEnabled(!next)
      setNotice(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice("已复制")
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "复制失败")
    }
  }

  async function exportSkill() {
    if (!install) return
    const destination = await pickDirectory()
    if (!destination) return
    const target = joinPath(destination, "qmai-mcp")
    try {
      if (await fileExists(target)) await deleteFile(target)
      await createDirectory(target)
      await copyDirectory(install.skillDir, target)
      setNotice(`已导出到 ${target}`)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "导出失败")
    }
  }

  async function openDoc() {
    const localDoc = install
      ? joinPath(install.skillDir.replace(/\/skills\/qmai-mcp\/?$/, ""), "docs/mcp-agent-tools-分支说明.md")
      : ""
    if (localDoc && await fileExists(localDoc).catch(() => false)) {
      const { openPath } = await import("@tauri-apps/plugin-opener")
      await openPath(localDoc)
      return
    }
    await openExternalUrl(MCP_DOC_URL)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">外部 Agent（MCP）</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          打开后，外部 Agent 可以调用写作对话、保存、改标题、提取记忆和排版。应用需保持打开。
        </p>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border">
        <div className="space-y-2 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">服务端口</span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={enabled ? "关闭服务端口" : "开启服务端口"}
              onClick={() => void toggle()}
              className="shrink-0"
            >
              <span
                aria-hidden="true"
                className={`relative inline-flex h-[21px] w-9 items-center rounded-full transition-colors ${
                  enabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-[15px] w-[15px] rounded-full bg-background transition-transform ${
                    enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </span>
            </button>
          </div>
          {enabled && port ? <p className="text-xs text-muted-foreground">端口号：{port}</p> : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {enabled
              ? "工具的服务端口已开启。命令行和 HTTP 均可调用工具。详细信息："
              : "工具的服务端口已关闭。打开后，命令行和 HTTP 均可调用工具。详细信息："}
            <button type="button" className="text-primary" onClick={() => void openDoc()}>
              文档
            </button>
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm">复制 MCP 配置</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!install}
            onClick={() => install && void copyText(buildMcpConfigInstallText(install.executablePath))}
          >
            复制
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-10 w-[100px] whitespace-normal px-2"
          disabled={!install}
          onClick={() => void exportSkill()}
        >
          导出 Skill
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-[200px] whitespace-nowrap"
          disabled={!install}
          onClick={() => install && void copyText(buildSkillInstallText(install.skillDir, install.version))}
        >
          复制 Skill 安装提示词
        </Button>
      </div>

      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
    </div>
  )
}

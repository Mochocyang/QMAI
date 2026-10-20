import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MCP_USAGE_EXAMPLES, buildMcpConfigInstallText, buildSkillInstallText } from "@/lib/mcp/copy-text"
import { applyMcpSettings, readBundledSkillInstallInfo, syncInstalledQmaiMcpSkill } from "@/lib/mcp/startup"
import { loadMcpSettings, saveMcpSettings } from "@/lib/project-store"

export function AgentMcpSection() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [skillsDir, setSkillsDir] = useState("")
  const [status, setStatus] = useState("")
  const [copyError, setCopyError] = useState("")
  const [install, setInstall] = useState<{ skillDir: string; version: string; executablePath: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const settings = await loadMcpSettings()
        if (cancelled) return
        setEnabled(settings.enabled)
        setSkillsDir(settings.agentSkillsDir)
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error))
      }
      try {
        const info = await readBundledSkillInstallInfo()
        if (!cancelled) setInstall(info)
      } catch (error) {
        if (!cancelled) setCopyError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function persist(nextEnabled: boolean, nextDir: string) {
    const settings = { enabled: nextEnabled, agentSkillsDir: nextDir.trim() }
    await saveMcpSettings(settings)
    const report = await applyMcpSettings(settings)
    setStatus(report.message)
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyError("")
      setStatus("已复制到剪贴板")
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "复制失败")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.categories.mcp", { defaultValue: "外部 Agent（MCP）" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          打开后，本机 Agent 可以通过 MCP 调用写作对话、保存文档、修改标题、提取记忆和章节排版。应用需要保持打开。
        </p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          aria-label="启用 MCP"
          onChange={(event) => {
            const next = event.target.checked
            setEnabled(next)
            void persist(next, skillsDir).catch((error) => {
              setStatus(error instanceof Error ? error.message : String(error))
            })
          }}
          className="h-4 w-4"
        />
        <span className="text-sm">启用 MCP</span>
      </label>

      <div className="space-y-2">
        <Label htmlFor="mcp-agent-skills-dir">Agent skills 目录</Label>
        <div className="flex gap-2">
          <Input
            id="mcp-agent-skills-dir"
            value={skillsDir}
            placeholder="外部 Agent 存放 skills 的目录"
            onChange={(event) => setSkillsDir(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void persist(enabled, skillsDir).catch((error) => {
                setStatus(error instanceof Error ? error.message : String(error))
              })
            }}
          >
            保存目录
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          应用启动、打开开关和保存这个目录时，会自检并只更新其中的 qmai-mcp。父目录不存在时不会创建。
        </p>
      </div>

      {status ? <p className="text-sm">{status}</p> : null}
      {copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}

      <div className="space-y-3">
        <h3 className="text-sm font-medium">使用示例</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {MCP_USAGE_EXAMPLES.map((example) => <li key={example}>{example}</li>)}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!install}
          onClick={() => {
            if (!install) return
            void copyText(buildMcpConfigInstallText(install.executablePath))
          }}
        >
          复制 MCP 配置说明
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!install}
          onClick={() => {
            if (!install) return
            void copyText(buildSkillInstallText(install.skillDir, install.version))
          }}
        >
          复制 Skill 安装说明
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void syncInstalledQmaiMcpSkill(skillsDir)
              .then((report) => setStatus(report.message))
              .catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
          }}
        >
          立即自检更新
        </Button>
      </div>
    </div>
  )
}

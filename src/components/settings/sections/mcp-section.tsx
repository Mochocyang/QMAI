import { useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore } from "@/stores/wiki-store"
import {
  createSampleGraphMcpServer,
  normalizeMcpConfig,
  normalizeMcpServerConfig,
  type McpConfig,
  type McpServerConfig,
} from "@/lib/mcp/config"
import { buildMcpRuntime } from "@/lib/mcp/runtime"

export function McpSection() {
  const { t } = useTranslation()
  const mcpConfig = useWikiStore((s) => s.mcpConfig)
  const setMcpConfig = useWikiStore((s) => s.setMcpConfig)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({})
  const [toolJsonDrafts, setToolJsonDrafts] = useState<Record<string, string>>({})
  const runtime = useMemo(() => buildMcpRuntime(mcpConfig), [mcpConfig])

  async function persist(next: McpConfig) {
    const normalized = normalizeMcpConfig(next)
    const { saveMcpConfig } = await import("@/lib/project-store")
    setMcpConfig(normalized)
    await saveMcpConfig(normalized)
    setSavedAt(Date.now())
    setTimeout(() => setSavedAt(null), 1500)
  }

  function updateServer(serverId: string, patch: Partial<McpServerConfig>) {
    const nextServers = mcpConfig.servers.map((server) => {
      if (server.id !== serverId) return server
      const nextServer = { ...server, ...patch }
      if (patch.id || patch.name) {
        nextServer.tools = nextServer.tools.map((tool) => ({
          ...tool,
          serverId: nextServer.id,
          serverName: nextServer.name,
        }))
      }
      return normalizeMcpServerConfig(nextServer) ?? server
    })
    void persist({ servers: nextServers })
  }

  function addSampleServer() {
    const sample = createSampleGraphMcpServer()
    const existingIds = new Set(mcpConfig.servers.map((server) => server.id))
    let next = sample
    let index = 2
    while (existingIds.has(next.id)) {
      const id = `graph_${index}`
      next = {
        ...sample,
        id,
        name: `${sample.name} ${index}`,
        tools: sample.tools.map((tool) => ({
          ...tool,
          serverId: id,
          serverName: `${sample.name} ${index}`,
        })),
      }
      index += 1
    }
    void persist({ servers: [...mcpConfig.servers, next] })
  }

  function removeServer(serverId: string) {
    if (!window.confirm(t("settings.sections.mcp.deleteConfirm"))) return
    void persist({ servers: mcpConfig.servers.filter((server) => server.id !== serverId) })
    setToolJsonDrafts((prev) => {
      const next = { ...prev }
      delete next[serverId]
      return next
    })
  }

  function updateToolsFromJson(server: McpServerConfig, value: string) {
    setToolJsonDrafts((prev) => ({ ...prev, [server.id]: value }))
    try {
      const parsed = JSON.parse(value)
      const normalized = normalizeMcpServerConfig({
        ...server,
        tools: parsed,
      })
      if (!normalized) throw new Error(t("settings.sections.mcp.invalidTools"))
      setJsonErrors((prev) => {
        const next = { ...prev }
        delete next[server.id]
        return next
      })
      setToolJsonDrafts((prev) => {
        const next = { ...prev }
        delete next[server.id]
        return next
      })
      updateServer(server.id, { tools: normalized.tools })
    } catch (error) {
      setJsonErrors((prev) => ({
        ...prev,
        [server.id]: error instanceof Error ? error.message : t("settings.sections.mcp.invalidJson"),
      }))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("settings.sections.mcp.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.sections.mcp.description")}
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0 gap-2" onClick={addSampleServer}>
          <Plus className="h-4 w-4" />
          {t("settings.sections.mcp.addSample")}
        </Button>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        {t("settings.sections.mcp.summary", {
          servers: mcpConfig.servers.length,
          tools: runtime.mcpTools.length,
          capabilities: runtime.mcpCapabilities.length,
        })}
        {savedAt ? <span className="ml-2 text-emerald-600">{t("settings.sections.mcp.saved")}</span> : null}
      </div>

      {runtime.warnings.length > 0 ? (
        <div className="space-y-1 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-medium">{t("settings.sections.mcp.warnings")}</div>
          {runtime.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {mcpConfig.servers.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("settings.sections.mcp.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {mcpConfig.servers.map((server) => (
            <div key={server.id} className="rounded-md border p-3">
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateServer(server.id, { enabled: !server.enabled })}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                    server.enabled
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
                  }`}
                  aria-label={server.enabled ? t("settings.sections.mcp.disable") : t("settings.sections.mcp.enable")}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                      server.enabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{server.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{server.id}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeServer(server.id)}
                  aria-label={t("settings.sections.mcp.delete")}
                  title={t("settings.sections.mcp.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("settings.sections.mcp.serverId")}</Label>
                  <Input value={server.id} onChange={(event) => updateServer(server.id, { id: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("settings.sections.mcp.serverName")}</Label>
                  <Input value={server.name} onChange={(event) => updateServer(server.id, { name: event.target.value })} />
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                <Label>{t("settings.sections.mcp.toolsJson")}</Label>
                <textarea
                  value={toolJsonDrafts[server.id] ?? JSON.stringify(server.tools, null, 2)}
                  onChange={(event) => updateToolsFromJson(server, event.target.value)}
                  className="min-h-44 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />
                {jsonErrors[server.id] ? (
                  <p className="text-xs text-destructive">{jsonErrors[server.id]}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("settings.sections.mcp.toolsJsonHint")}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

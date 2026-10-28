/**
 * 设置页里的「插件 provider」运行期卡片（T4）。
 *
 * 为什么是运行期 preset 而不是往 `LLM_PRESETS` 里加内容：
 * `LLM_PRESETS` 是静态数组（内置 11 个 provider 的策划目录），插件 provider 是
 * 装/卸/启/停都会变的运行期对象。把它转成与 preset 同形状的对象再追加到渲染列表，
 * 既能复用卡片的排版与品牌位，又不会让静态目录随插件状态漂移。
 *
 * v2.0 的边界（设计 §5 / 计划第 5.2 节）：
 *   - `登录/设置` 只处理 `authKind === "none"`：其余一律明说「后续版本提供」。
 *     这里**不伪造**登录界面 —— 假 UI 会让用户以为凭据已经交给了软件。
 *   - `刷新模型` 只走 Rust 命令 `plugins_provider_refresh_models`，
 *     不能复用 `settings-model-list.buildModelsUrl`：那条路会去读 `apiKey`
 *     并抛「令牌尚未获取」（插件 token 只在 Rust 内存里）。
 */
import { useState } from "react"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { pluginsApi } from "@/lib/plugins/api"
import { syncPluginProviders } from "@/lib/plugins/provider-sync"
import type { PluginProviderModel, PluginProviderView } from "@/lib/plugins/types"
import type { LlmPreset } from "../llm-presets"

/**
 * 插件 provider 的 preset 形状。
 *
 * 额外字段只用于卡片展示与按钮分支，不参与模型解析 —— 模型解析读的是
 * `providerConfigs[providerId]`（同步写进去的），两条数据源名字相同、含义不同：
 * 这里的是「Rust 刚报上来的状态」，那里的是「界面与请求层实际在用的配置」。
 */
export interface PluginProviderPreset extends LlmPreset {
  pluginId: string
  authKind: PluginProviderView["authKind"]
  ready: boolean
  lastError?: string
  /** 运行期模型（带上下文窗口，卡片上显示；未就绪时可能为空）。 */
  models: PluginProviderModel[]
}

function maxOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((max, value) => (value > max ? value : max), values[0])
}

export function toPluginProviderPreset(view: PluginProviderView): PluginProviderPreset {
  return {
    // preset.id 必须等于 provider id：它同时是 `providerConfigs` 的键，也是
    // 模型复合键 `providerId/modelId` 的前缀（设计 D1）。三者错位就会选到别人的模型。
    id: view.providerId,
    label: view.name || view.providerId,
    hint: `来自插件 ${view.pluginId}`,
    provider: view.providerId,
    defaultModel: view.models[0]?.id,
    suggestedContextSize: maxOf(view.models.map((model) => model.maxInputTokens)),
    suggestedMaxOutputTokens: maxOf(view.models.map((model) => model.maxOutputTokens)),
    pluginId: view.pluginId,
    authKind: view.authKind,
    ready: view.ready,
    lastError: view.lastError,
    models: view.models,
  }
}

/** 读 Tauri 命令失败原因（与插件管理页同一套约定：字符串优先）。 */
function describeError(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return "操作失败，请重试。"
}

export function PluginProviderCard({
  preset,
  expanded,
  onToggle,
}: {
  preset: PluginProviderPreset
  expanded: boolean
  onToggle: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null)

  async function refreshModels() {
    if (busy) return
    setBusy(true)
    setStatus(null)
    try {
      // 只走 Rust 命令：它知道怎么带着 token 打插件的 /v1/models。
      await pluginsApi.refreshProviderModels(preset.id)
      // 抓完模型再同步一次，`providerConfigs` 与界面才会一起更新。
      await syncPluginProviders()
      setStatus({ error: false, text: "模型列表已刷新。" })
    } catch (cause) {
      setStatus({ error: true, text: `刷新失败：${describeError(cause)}` })
    } finally {
      setBusy(false)
    }
  }

  function openSettings() {
    // v2.0 只做「说清楚」：插件自托管的登录页要到 v2.1 才用受控窗口打开。
    setStatus({
      error: false,
      text:
        preset.authKind === "none"
          ? "该插件不需要登录。"
          : "登录界面将在后续版本提供：本版本还不会打开插件的登录页。",
    })
  }

  return (
    <div
      className={`model-preset-card ${preset.ready ? "" : "opacity-60"}`}
      data-model-provider={preset.id}
      data-plugin-provider="true"
      data-ready={preset.ready ? "true" : "false"}
    >
      <div className="model-provider-head">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? "收起" : "展开"}
        >
          <span className="flex flex-wrap items-center gap-2">
            <strong className="break-words">{preset.label}</strong>
            {preset.ready ? null : (
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[0.6875rem] text-destructive">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                未就绪
              </span>
            )}
          </span>
          <small className="mt-0.5 block text-xs text-muted-foreground">
            来自插件 {preset.pluginId}
            {preset.models.length > 0 ? ` · ${preset.models.length} 个模型` : ""}
          </small>
        </button>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refreshModels()}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            {busy ? "刷新中…" : "刷新模型"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={openSettings}>
            登录/设置
          </Button>
        </div>
      </div>

      {preset.ready ? null : (
        <p className="px-1 pb-2 text-xs leading-relaxed text-destructive" role="status">
          {preset.lastError?.trim() || "插件没有通过健康检查，模型暂不可用。"}
        </p>
      )}

      {expanded ? (
        <div className="model-preset-body space-y-2 border-t bg-background/50 p-3">
          {preset.models.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              插件还没有报告任何模型。先点「刷新模型」；仍为空的话，这个插件可能还没准备好。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {preset.models.map((model) => (
                <span
                  key={model.id}
                  className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem]"
                  title={`上下文 ${model.maxInputTokens.toLocaleString()} tokens · 输出上限 ${model.maxOutputTokens.toLocaleString()} tokens`}
                >
                  {model.name || model.id}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            模型由插件通过 <code>/v1/models</code> 提供，不能在这里手工增删；插件的模型变了就点「刷新模型」。
            停用或卸载插件后，这些模型会从选择器里消失。
          </p>
        </div>
      ) : null}

      {status ? (
        <p
          className={`px-1 pb-2 text-xs ${status.error ? "text-destructive" : "text-muted-foreground"}`}
          role="status"
          aria-live="polite"
        >
          {status.text}
        </p>
      ) : null}
    </div>
  )
}

import { confirmModelAction } from "@/components/uitest/models/model-confirm"
import { ModelSecretInput } from "@/components/uitest/models/model-secret-input"
import { useUiTestProviderBatch } from "@/components/uitest/models/provider-batch"
import { isProviderAvailable } from "@/lib/llm-model-keys"
import { useProviderDraft } from "@/components/uitest/models/provider-draft"
import { useModelDraftGuard } from "@/components/uitest/models/model-draft-guard"
import { deleteUiTestProvider } from "@/components/uitest/models/provider-save"
import { validateProviderDraft } from "@/components/uitest/models/provider-data"
import { safeModelError } from "@/components/uitest/models/model-feedback"
import "@/components/uitest/models/model-settings.css"
import { useEffect, useMemo, useState, useRef } from "react"
import { AlertCircle, CheckCircle2, Loader2, XCircle, X, Trash2 } from "lucide-react"
import { ModelConfigTitle, ProviderBrandIcon, modelEnableLabel, modelSaveLabel } from "../provider-brand-icon"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore, type ProviderOverride, type ReasoningConfig, type ReasoningMode, type SavedModel } from "@/stores/wiki-store"
import { LLM_PRESETS, type LlmPreset } from "../llm-presets"
import { ContextSizeSelector } from "../context-size-selector"
import { OutputTokensSelector } from "../output-tokens-selector"
import { resolveConfig } from "../preset-resolver"
import { normalizeEndpoint } from "@/lib/endpoint-normalizer"
import { isTauri } from "@/lib/platform"
import { AZURE_OPENAI_API_VERSION } from "@/lib/azure-openai"
import type { ProviderTestResult } from "@/lib/connection-tests"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import { mergeProviderModels, removeProviderModel } from "@/components/uitest/models/provider-data"
import { UiTestProviderCard } from "@/components/uitest/models/provider-custom"
import {
  MIN_USER_LLM_CONTEXT_SIZE,
  normalizeUserLlmMaxOutputTokens,
} from "@/lib/llm-context-size"
import { thinkingMinMaxTokens } from "@/lib/llm-providers"
import { resolveCodexCliTimeoutMinutes } from "@/lib/codex-cli-timeout"
import { resolveCodexSpeedMode } from "@/lib/codex-cli-speed"

const UI_TEST_PROVIDER_HINTS: Record<string, string> = {
  anthropic: "官方 Claude API",
  "claude-code-cli": "使用本机 claude 命令及其登录状态，无需 API Key",
  "codex-cli": "使用本机 codex 命令及其登录状态，无需 API Key",
  "cursor-cli": "通过 cursor-api-proxy 使用本机 agent 命令，无需官方 API Key",
  openai: "官方 OpenAI API",
  google: "Google 生成式语言 API",
  azure: "Azure OpenAI 资源接口；模型字段填写部署名称",
  "ollama-local": "本机部署的 llama.cpp / Ollama 服务",
}

/**
 * Raise the declared output ceiling when the chosen reasoning level needs more
 * room than it currently allows.
 *
 * Thinking and the final answer share one output allowance. When the ceiling is
 * too low the request layer drops thinking rather than silently inflating
 * `max_tokens` past what the model accepts, so the fix belongs here: adjust the
 * user's own setting, at the moment they change the level, where they can see
 * and undo it.
 */
export function withOutputRoomForReasoning(
  reasoning: ReasoningConfig,
  currentMaxOutputTokens: number | undefined,
): ProviderOverride {
  const required = thinkingMinMaxTokens(reasoning)
  const current = normalizeUserLlmMaxOutputTokens(currentMaxOutputTokens)
  if (required <= current) return { reasoning }
  return { reasoning, maxOutputTokens: normalizeUserLlmMaxOutputTokens(required) }
}

export function LlmProviderSection() {
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [uiTestSource, setUiTestSource] = useState<"library" | "custom" | "presets">("library")
  const [selectedPresetId, setSelectedPresetId] = useState(LLM_PRESETS.find((preset) => preset.id !== "custom")?.id ?? "")
  const [customDraftIds, setCustomDraftIds] = useState<string[]>([])
  const [presetDraftIds, setPresetDraftIds] = useState<string[]>([])
  const selectPreset = (id: string) => {
    setSelectedPresetId(id)
    setPresetDraftIds(ids => ids.includes(id) ? ids : [...ids, id])
    setExpanded({ [id]: true })
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ [id]: !prev[id] }))
  }

  const configured = [...new Set([...Object.keys(providerConfigs), ...customDraftIds, ...presetDraftIds])]
    const presets = LLM_PRESETS.filter((preset) => preset.id !== "custom")
    const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0]
    return (
      <div data-ui="llm-library">
        <div className="model-library-heading"><h3>我的模型配置</h3><span>{configured.length} 个配置</span></div>
        <div className="model-library-list">
          {configured.map((id) => {
            const config = providerConfigs[id] ?? {}
            const preset = LLM_PRESETS.find((item) => item.id === id)
            return <div key={id}>{id.startsWith("custom-") ? <UiTestProviderCard id={id} isNew={customDraftIds.includes(id)} expanded={!!expanded[id]} onToggle={() => toggleExpand(id)} onRemoved={() => setCustomDraftIds((ids) => ids.filter((item) => item !== id))} /> : preset ? <UiTestPresetCard preset={{ ...preset, hint: UI_TEST_PROVIDER_HINTS[preset.id] ?? preset.hint }} expanded={!!expanded[id]} onToggle={() => toggleExpand(id)} onRemoved={() => setPresetDraftIds(ids => ids.filter(item => item !== id))} /> : <div className="model-library-item"><div><strong>{config.label || "自定义模型"}</strong><small>{config.model || "未选择模型"}</small></div></div>}</div>
          })}
          {!configured.length && <p>还没有模型配置。</p>}
        </div>
        <div className="model-add-row">
          <button type="button" className="model-add-card" onClick={() => { if (uiTestSource !== "presets") selectPreset(selectedPresetId); setUiTestSource(uiTestSource === "presets" ? "library" : "presets") }}>＋ 添加提供方</button>
          <button type="button" className="model-add-card" onClick={() => { const id = `custom-${crypto.randomUUID()}`; setCustomDraftIds((ids) => [...ids, id]); setExpanded({ [id]: true }); setUiTestSource("library") }}>＋ 添加自定义模型</button>
        </div>
        {uiTestSource === "presets" && selectedPreset && <div className="model-add-panel">
          <div className="model-provider-grid">{presets.map((preset) => <button type="button" key={preset.id} className={preset.id === selectedPreset.id ? "is-selected" : ""} onClick={() => selectPreset(preset.id)}><span className="model-provider-grid-name"><ProviderBrandIcon presetId={preset.id} /><strong>{preset.label}</strong></span><small>{UI_TEST_PROVIDER_HINTS[preset.id] ?? preset.hint}</small></button>)}</div>
        </div>}
      </div>
    )

}

interface PresetRowProps {
  preset: LlmPreset
  override: ProviderOverride | undefined
  isActive: boolean
  isEnabled: boolean
  isExpanded: boolean
  persisted: boolean
  dirty: boolean
  onToggleActive: () => void
  onToggleEnabled: () => void
  onToggleExpand: () => void
  onChange: (patch: ProviderOverride) => void
  manual: string
  onManualChange: (value: string) => void
  onReasoningModeChange: (mode: ReasoningMode) => void
}

function UiTestProviderModelInput({ model, savedModels, options, failedModels, onChange, manual, onManualChange: setManual }: { model: string; savedModels: SavedModel[]; options: string[]; failedModels: string[]; onChange: (patch: ProviderOverride) => void; manual: string; onManualChange: (value: string) => void }) {
  const add = (values: string[], includeManual = false) => {
    const source = includeManual ? { model, savedModels } : { model: "", savedModels }
    const next = mergeProviderModels(source, values)
    onChange({ model: next.model, savedModels: next.savedModels })
    setManual("")
  }
  return <div className="model-field full"><span>模型</span><div className="model-tag-input">
    {savedModels.map(item => <span key={item.id} className={failedModels.includes(item.model) ? "is-failed" : ""}>{item.model}<button type="button" aria-label={`移除模型${item.model}`} onClick={() => onChange(removeProviderModel({ model, savedModels }, item.model))}><X /></button></span>)}
    <div className="model-tag-compose">
      <input aria-label="模型" value={manual} onChange={event => setManual(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(manual.split(/[,，\n]+/), true) } }} placeholder={savedModels.length ? "输入模型名称，按回车添加" : "输入模型名称或拉取后选择"} spellCheck={false} />
      <button type="button" className="model-button" disabled={!manual.trim()} onClick={() => add(manual.split(/[,，\n]+/), true)}>添加</button>
    </div>
  </div>{!!options.length && <div className="model-catalog"><div className="model-section-heading"><p>已拉取 {options.length} 个模型 · 已选择 {savedModels.length} 个</p><div className="model-actions"><button type="button" className="model-button ghost" onClick={() => add(options)}>全选</button><button type="button" className="model-button ghost" onClick={() => onChange({ savedModels: [], model: "" })}>清空</button></div></div><p className="model-note">点击模型加入上方输入框，再次点击可取消。</p><div className="model-catalog-list">{options.map(item => { const selected = savedModels.some(saved => saved.model === item); return <button type="button" key={item} aria-pressed={selected} className={failedModels.includes(item) ? "is-failed" : ""} onClick={() => selected ? onChange(removeProviderModel({ model, savedModels }, item)) : add([item])}>{item}</button> })}</div></div>}</div>
}

function UiTestPresetCard({ preset, expanded, onToggle, onRemoved }: { preset: LlmPreset; expanded: boolean; onToggle: () => void; onRemoved: () => void }) {
  const initial = useMemo<ProviderOverride>(() => ({ model: preset.defaultModel ?? "", baseUrl: preset.baseUrl, apiMode: preset.apiMode, maxContextSize: preset.suggestedContextSize ?? MIN_USER_LLM_CONTEXT_SIZE, maxOutputTokens: preset.suggestedMaxOutputTokens ?? 131072 }), [preset.id])
  const { draft, saved, dirty, saving, status, update, save, saveSwitch, reset, setStatus } = useProviderDraft(preset.id, initial)
  const [manual, setManual] = useState("")
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const localCli = preset.provider === "claude-code" || preset.provider === "codex-cli" || preset.provider === "cursor-cli"
  const enabled = isProviderAvailable(preset.id, saved ?? {})
  const hasDraft = dirty || Boolean(manual.trim())
  const saveConfig = () => save(manual.trim() ? "还有未加入列表的模型 ID，请先点击“添加”，再保存配置。" : validateProviderDraft(draft, { endpointRequired: !localCli && ["custom", "azure", "ollama"].includes(preset.provider), modelRequired: !localCli }))
  const discard = () => { reset(); setManual("") }
  useModelDraftGuard(`provider:${preset.id}`, "提供方配置", hasDraft, saving || deleting, saveConfig, discard)
  async function remove() {
    if (deletingRef.current || saving) return
    deletingRef.current = true; setDeleting(true)
    try { if (await deleteUiTestProvider(preset.id, saved, preset.label, hasDraft)) onRemoved() }
    catch (error) { setStatus({ error: true, text: `删除失败：${safeModelError(error, [draft.apiKey ?? "", saved?.apiKey ?? ""])}；配置和当前输入已保留。` }) }
    finally { deletingRef.current = false; setDeleting(false) }
  }
  const change = (patch: ProviderOverride) => {
    if (Object.keys(patch).length && Object.keys(patch).every(key => ["enabled", "functionCallingEnabled", "localCliIsolation", "codexSpeedMode"].includes(key))) void saveSwitch(patch)
    else update(patch)
  }
  return <div className="model-preset-card" data-model-provider={preset.id}>
    <fieldset disabled={saving || deleting}>
      <PresetRow preset={preset} override={draft} isActive={false} isEnabled={enabled} isExpanded={expanded} persisted={Boolean(saved)} dirty={hasDraft} onToggleActive={() => {}} onToggleEnabled={() => void saveSwitch({ enabled: !enabled })} onToggleExpand={onToggle} onChange={change} manual={manual} onManualChange={setManual} onReasoningModeChange={mode => void saveSwitch(withOutputRoomForReasoning({ ...saved?.reasoning, mode }, saved?.maxOutputTokens ?? initial.maxOutputTokens))} />
    </fieldset>
    {(expanded || hasDraft || status) && <div className="model-save-footer"><div><p role="status" aria-live="polite" className={status?.error ? "model-feedback error" : "model-feedback"}>{status?.text ?? (manual.trim() ? "还有未加入列表的模型 ID，请先点击“添加”。" : hasDraft ? "有未保存修改，开关已独立保存。" : saved ? "当前配置已保存。" : "提供方模型，尚未启用。")}</p><small>测试不会自动保存。</small></div><div className="model-actions"><button type="button" className="model-icon-button danger" title="删除配置" aria-label="删除配置" disabled={saving || deleting} onClick={() => void remove()}><Trash2 /></button>{hasDraft && <button type="button" className="model-button ghost" disabled={saving || deleting} onClick={async () => { if (await confirmModelAction("放弃本项未保存修改？")) discard() }}>放弃修改</button>}<button type="button" className="model-button primary" disabled={!hasDraft || saving || deleting || Boolean(manual.trim())} onClick={() => void saveConfig()}>{saving ? "正在保存…" : "保存配置"}</button></div></div>}
  </div>
}

type ProviderTestState =
  | { kind: "idle" }
  | { kind: "running"; label: string }
  | { kind: "done"; result: ProviderTestResult }

type ModelActionState =
  | { loading: boolean; success: boolean; message: string }
  | null

function PresetRow({
  preset,
  override,
  isActive: _isActive,
  isEnabled,
  isExpanded,
  persisted,
  dirty,
  onToggleActive: _onToggleActive,
  onToggleEnabled,
  onToggleExpand,
  onChange,
  manual,
  onManualChange,
  onReasoningModeChange,
}: PresetRowProps) {
  const { t } = useTranslation()
  const ov = override ?? {}
  const model = ov.model?.trim() || preset.defaultModel || ""
  const apiKey = ov.apiKey ?? ""
  const apiMode = ov.apiMode ?? preset.apiMode ?? "chat_completions"
  const baseUrl = ov.baseUrl ?? preset.baseUrl ?? ""
  const azureApiVersion = ov.azureApiVersion ?? preset.azureApiVersion ?? AZURE_OPENAI_API_VERSION
  const azureModelFamily = ov.azureModelFamily ?? preset.azureModelFamily ?? "auto"
  const context = ov.maxContextSize ?? preset.suggestedContextSize ?? MIN_USER_LLM_CONTEXT_SIZE
  const maxOutputTokens = normalizeUserLlmMaxOutputTokens(
    ov.maxOutputTokens ?? preset.suggestedMaxOutputTokens,
  )
  const reasoning = ov.reasoning ?? { mode: "auto" as const }
  const localCliIsolation = ov.localCliIsolation === true
  const codexCliTimeoutMinutes = resolveCodexCliTimeoutMinutes(ov.codexCliTimeoutMinutes)
  const codexSpeedMode = resolveCodexSpeedMode(ov.codexSpeedMode)
  const codexFastEnabled = codexSpeedMode === "fast"
  const showLocalCliIsolation = preset.provider === "claude-code"
  const isCursorCliProvider = preset.provider === "cursor-cli"
  const [, setTestState] = useState<ProviderTestState>({ kind: "idle" })
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelListState, setModelListState] = useState<ModelActionState>(null)
  const [, setIsModelSelectionExpanded] = useState(false)
  const uiTestCurrentOverride = useRef(JSON.stringify(ov))
  const uiTestRevision = useRef(0), uiTestMounted = useRef(true)
  if (uiTestCurrentOverride.current !== JSON.stringify(ov)) {
    uiTestCurrentOverride.current = JSON.stringify(ov)
    uiTestRevision.current++
  }
  useEffect(() => { uiTestMounted.current = true; return () => { uiTestMounted.current = false; uiTestRevision.current++ } }, [])
  useEffect(() => { setTestState({ kind: "idle" }); setModelListState(null) }, [ov])
  const uiTestBatch = useUiTestProviderBatch(ov, true)
  const { modelTestState, runBatchTest, retryFailed } = uiTestBatch
  // Local CLI providers authenticate via their own existing login state
  // (inherited by the spawned subprocess), so no API key field is shown.
  // Ollama ditto for its local-only model. Cursor CLI uses cursor-api-proxy;
  // bridge auth key is optional (only if CURSOR_BRIDGE_API_KEY is set).
  const needsApiKey =
    preset.provider !== "ollama" &&
    preset.provider !== "claude-code" &&
    preset.provider !== "codex-cli" &&
    preset.provider !== "cursor-cli"

  const resolvedConfig = useMemo(
    () => resolveConfig(preset, ov, useWikiStore.getState().llmConfig),
    [apiKey, apiMode, azureApiVersion, azureModelFamily, baseUrl, context, model, preset, reasoning, ov],
  )

  useEffect(() => {
    setModelOptions([])
    setModelListState(null)
  }, [apiKey, apiMode, baseUrl, preset.id, preset.provider])

  async function loadModelOptions() {
    const captured = uiTestRevision.current
    setModelListState({
      loading: true,
      success: false,
      message: t("settings.sections.shared.loadingModels"),
    })

    try {
      const result = await fetchLlmModelList(resolvedConfig)
      if (!uiTestMounted.current || uiTestRevision.current !== captured) return
      setModelOptions(result.models)

      // 拉取成功后自动展开模型选择区域
      setIsModelSelectionExpanded(true)

      setModelListState({
        loading: false,
        success: true,
        message: t("settings.sections.shared.modelListSuccess", { count: result.models.length }),
      })
    } catch (error) {
      if (!uiTestMounted.current || uiTestRevision.current !== captured) return
      setModelListState({
        loading: false,
        success: false,
        message: t("settings.sections.shared.modelListFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    }
  }

  async function runSelectedModelTest() {
    const savedModels = ov.savedModels ?? []
    const modelsToTest = savedModels.length > 0
      ? savedModels.map((m) => m.model)
      : [model]
    await runBatchTest(modelsToTest, (modelId) => ({ ...resolvedConfig, model: modelId }))
  }

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isEnabled ? "border-primary/60 bg-primary/5" : "border-border"
      }`}
    >
      <div className="model-provider-head">
        <ModelConfigTitle
          expanded={isExpanded}
          onToggle={onToggleExpand}
          name={preset.label}
          saveLabel={modelSaveLabel(persisted, dirty)}
          enableLabel={modelEnableLabel(isEnabled)}
          hint={preset.hint}
          mark={<ProviderBrandIcon presetId={preset.id} />}
          title={isExpanded ? t("settings.sections.llm.collapse") : t("settings.sections.llm.expand")}
        />
        <button
          type="button"
          role="switch"
          aria-checked={isEnabled}
          onClick={onToggleEnabled}
          className="model-switch"
          title={isEnabled ? t("settings.sections.llm.toggleOff") : t("settings.sections.llm.toggleOn")}
          aria-label={isEnabled ? t("settings.sections.llm.deactivate") : t("settings.sections.llm.activate")}
        >
          <span />
        </button>
      </div>

      {/* Expanded config panel */}
      {isExpanded && (
        <div className="model-preset-body space-y-4 border-t bg-background/50">
          {preset.provider === "custom" && (
            <div className="space-y-2">
              <Label>{t("settings.sections.llm.apiMode")}</Label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { value: "chat_completions", labelKey: "settings.sections.llm.wireOpenAi" },
                    { value: "responses", labelKey: "settings.sections.llm.wireResponses" },
                    { value: "anthropic_messages", labelKey: "settings.sections.llm.wireAnthropic" },
                  ] as const
                ).map((m) => {
                  const active = apiMode === m.value
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => {
                        // When a preset declares different base URLs for
                        // each wire (e.g. Bailian Coding Plan: /v1 for
                        // OpenAI, /apps/anthropic for Anthropic), flip
                        // the URL alongside the mode so users don't have
                        // to know both URLs or edit manually.
                        const patch: ProviderOverride = { apiMode: m.value }
                        const nextBaseUrl = preset.baseUrlByMode?.[m.value]
                        if (nextBaseUrl) patch.baseUrl = nextBaseUrl
                        onChange(patch)
                      }}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {t(m.labelKey)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {(preset.provider === "custom" || preset.provider === "ollama" || preset.provider === "azure") && (
            <EndpointField
              value={baseUrl}
              mode={preset.provider === "azure" ? "azure" : apiMode}
              placeholder={preset.baseUrl ?? "https://your-api.example.com/v1"}
              onChange={(v) => onChange({ baseUrl: v })}
            />
          )}

          {preset.provider === "azure" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("settings.sections.llm.azureApiVersion")}</Label>
                <Input
                  value={azureApiVersion}
                  onChange={(e) => onChange({ azureApiVersion: e.target.value })}
                  placeholder="2024-10-21"
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.llm.azureApiVersionHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("settings.sections.llm.azureModelFamily")}</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={azureModelFamily}
                  onChange={(e) => onChange({ azureModelFamily: e.target.value as typeof azureModelFamily })}
                >
                  <option value="auto">{t("settings.sections.llm.azureModelFamilyAuto")}</option>
                  <option value="gpt5">{t("settings.sections.llm.azureModelFamilyGpt5")}</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.llm.azureModelFamilyHint")}
                </p>
              </div>
            </div>
          )}

          {preset.provider === "claude-code" && <ClaudeCliStatusPill />}
          {preset.provider === "codex-cli" && <CodexCliStatusPill />}
          {isCursorCliProvider && <CursorCliStatusPill />}

          {isCursorCliProvider && (
            <div className="space-y-2">
              <Label>{t("settings.sections.llm.cursorBridgeApiKey")}</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => onChange({ apiKey: e.target.value })}
                placeholder={t("settings.sections.llm.cursorBridgeApiKeyPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.llm.cursorBridgeApiKeyHint")}
              </p>
            </div>
          )}

          {showLocalCliIsolation && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {t("settings.sections.llm.localCliIsolation")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("settings.sections.llm.localCliIsolationHint")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange({ localCliIsolation: !localCliIsolation })}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                    localCliIsolation
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
                  }`}
                  title={
                    localCliIsolation
                      ? t("settings.sections.llm.localCliIsolationOn")
                      : t("settings.sections.llm.localCliIsolationOff")
                  }
                  aria-label={t("settings.sections.llm.localCliIsolation")}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                      localCliIsolation ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              <div className="rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
                {localCliIsolation
                  ? t("settings.sections.llm.localCliIsolationOn")
                  : t("settings.sections.llm.localCliIsolationOff")}
              </div>
            </div>
          )}

          {preset.provider === "codex-cli" && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {t("settings.sections.llm.codexSpeed")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {codexFastEnabled
                      ? t("settings.sections.llm.codexSpeedFast")
                      : t("settings.sections.llm.codexSpeedStandard")}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={codexFastEnabled}
                  aria-label={t("settings.sections.llm.codexSpeed")}
                  onClick={() => onChange({
                    codexSpeedMode: codexFastEnabled ? "standard" : "fast",
                  })}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                    codexFastEnabled
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                      codexFastEnabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.llm.codexSpeedHint")}
              </p>
            </div>
          )}

          {preset.provider === "codex-cli" && (
            <div className="space-y-2 rounded-md border p-3">
              <Label>{t("settings.sections.llm.codexCliTimeout")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={240}
                  className="w-28"
                  value={codexCliTimeoutMinutes}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    onChange({
                      codexCliTimeoutMinutes: Number.isFinite(n)
                        ? Math.max(1, Math.min(240, Math.floor(n)))
                        : undefined,
                    })
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {t("settings.sections.llm.codexCliTimeoutUnit")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.llm.codexCliTimeoutHint")}
              </p>
            </div>
          )}

          {needsApiKey && (
            <div className="space-y-2">
              <Label>{t("settings.sections.llm.apiKey")}</Label>
              <ModelSecretInput value={apiKey} onChange={(apiKey) => onChange({ apiKey })} />
            </div>
          )}

          <UiTestProviderModelInput
            manual={manual}
            onManualChange={onManualChange}
            model={model}
            savedModels={ov.savedModels ?? []}
            options={modelOptions}
            failedModels={modelTestState?.failedModels ?? []}
            onChange={onChange}
          />

          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadModelOptions()}
                disabled={modelListState?.loading || modelTestState?.loading}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {modelListState?.loading
                  ? t("settings.sections.llm.loadingModels")
                  : t("settings.sections.llm.fetchModels")}
              </button>
              <button
                type="button"
                onClick={() => void runSelectedModelTest()}
                disabled={modelListState?.loading || modelTestState?.loading}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {modelTestState?.loading
                  ? t("settings.sections.shared.testing")
                  : t("settings.sections.shared.testModel")}
              </button>
            </div>
            {modelListState?.message ? (
              <p className={`text-xs ${modelListState.success ? "text-emerald-600" : "text-destructive"}`}>
                {safeModelError(modelListState.message, [apiKey])}
              </p>
            ) : null}
            {modelTestState?.message ? (
              <div className="space-y-1.5">
                <p className={`text-xs ${modelTestState.success ? "text-emerald-600" : "text-destructive"}`}>
                  {safeModelError(modelTestState.message, [apiKey])}
                </p>
                {modelTestState.failedModels && modelTestState.failedModels.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">失败模型：</span>
                    {modelTestState.failedModels.map((failedModel) => (
                      <span
                        key={failedModel}
                        className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
                      >
                        {failedModel}
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => void retryFailed((modelId) => ({ ...resolvedConfig, model: modelId }))}
                      disabled={modelTestState.loading}
                      className="rounded-md border border-destructive/30 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      重试失败模型
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{t("settings.sections.llm.contextWindow")}</Label>
            <ContextSizeSelector
              value={context}
              onChange={(v) => onChange({ maxContextSize: v })}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("settings.sections.llm.maxOutputTokens")}</Label>
            <OutputTokensSelector
              value={maxOutputTokens}
              contextWindow={context}
              onChange={(v) => onChange({ maxOutputTokens: v })}
            />
          </div>

          {preset.provider !== "cursor-cli" && (
            <ReasoningControls
              value={reasoning}
              onChange={(next) => onChange(withOutputRoomForReasoning(next, maxOutputTokens))}
              onModeChange={onReasoningModeChange}
            />
          )}

          <FunctionCallingControls
            enabled={ov.functionCallingEnabled !== false}
            onChange={(functionCallingEnabled) => onChange({ functionCallingEnabled })}
          />
        </div>
      )}
    </div>
  )
}

export function FunctionCallingControls({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className={`flex items-center justify-between rounded-md border-2 p-3 transition-colors ${
        enabled
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-background"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {t("settings.sections.llm.functionCalling.label", "启用 Function Calling")}
        </div>
        <div className="text-xs text-muted-foreground">
          {t(
            "settings.sections.llm.functionCalling.hint",
            "关闭后，使用该供应商时请求不携带 tools/tool_choice（含内置工具），用于兼容不支持工具调用的中转或本地模型。",
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        role="switch"
        aria-checked={enabled}
        aria-label={t("settings.sections.llm.functionCalling.label", "启用 Function Calling")}
        className="ml-3 flex shrink-0 items-center gap-2"
      >
        <span
          className={`text-xs font-semibold ${
            enabled ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {enabled
            ? t("settings.sections.llm.functionCalling.stateOn", "ON")
            : t("settings.sections.llm.functionCalling.stateOff", "OFF")}
        </span>
        <span
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
    </div>
  )
}

export function ReasoningControls({
  value,
  onChange,
  onModeChange,
}: {
  value: ReasoningConfig
  onChange: (value: ReasoningConfig) => void
  onModeChange: (mode: ReasoningMode) => void
}) {
  const { t } = useTranslation()
  const modes: { value: ReasoningMode; label: string }[] = [
    { value: "auto", label: t("settings.sections.llm.reasoning.auto") },
    { value: "off", label: t("settings.sections.llm.reasoning.off") },
    { value: "low", label: t("settings.sections.llm.reasoning.low") },
    { value: "medium", label: t("settings.sections.llm.reasoning.medium") },
    { value: "high", label: t("settings.sections.llm.reasoning.high") },
    { value: "max", label: t("settings.sections.llm.reasoning.max") },
    { value: "custom", label: t("settings.sections.llm.reasoning.custom") },
  ]

  return (
    <div className="space-y-2">
      <Label>{t("settings.sections.llm.reasoning.title")}</Label>
      <div className="flex flex-wrap gap-1.5">
        {modes.map((m) => {
          const active = value.mode === m.value
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => onModeChange(m.value)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent"
              }`}
            >
              {m.label}
            </button>
          )
        })}
      </div>
      {value.mode === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            className="w-28"
            value={value.budgetTokens ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim()
              const n = Number(raw)
              onChange({
                ...value,
                budgetTokens: raw === "" || !Number.isFinite(n) ? undefined : Math.max(0, n),
              })
            }}
            placeholder="1024"
          />
          <span className="text-xs text-muted-foreground">
            {t("settings.sections.llm.reasoning.budgetTokens")}
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t("settings.sections.llm.reasoning.hint")}
      </p>
    </div>
  )
}

interface EndpointFieldProps {
  value: string
  mode: "chat_completions" | "responses" | "anthropic_messages" | "azure"
  placeholder: string
  onChange: (value: string) => void
}

/**
 * Endpoint input with live feedback + auto-fix on blur. The hint line
 * below the field tells the user what we'd normalize to (and why) while
 * they're typing; the input doesn't nag — it just shows the preview. On
 * blur, if normalization would change the value, we apply it.
 */
function EndpointField({ value, mode, placeholder, onChange }: EndpointFieldProps) {
  const { t } = useTranslation()
  const preview = useMemo(() => normalizeEndpoint(value, mode), [value, mode])

  function handleBlur() {
    if (preview.changed && preview.normalized !== value.trim()) {
      onChange(preview.normalized)
    }
  }

  const showHint = value.trim().length > 0 && (preview.changed || preview.warning)

  return (
    <div className="space-y-1.5">
      <Label>{t("settings.sections.llm.endpoint")}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
      />
      {showHint && (
        <div
          className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
            preview.changed
              ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
              : "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400"
          }`}
        >
          {preview.changed ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            {preview.changed && (
              <div>
                {t("settings.sections.llm.endpointPreviewWillUse")}{" "}
                <code className="break-all rounded bg-background/60 px-1 py-0.5 font-mono">
                  {preview.normalized || "(empty)"}
                </code>
                <span className="ml-1 text-muted-foreground">
                  {t("settings.sections.llm.endpointPreviewAutoApply")}
                </span>
              </div>
            )}
            {preview.warning && <div>{preview.warning}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

interface DetectResult {
  installed: boolean
  version: string | null
  path: string | null
  appServerReady?: boolean
  dynamicToolsReady?: boolean
  models?: string[]
  error: string | null
}

/**
 * Health-check pill for the Claude Code CLI provider. Auto-runs
 * `claude --version` on mount, with a refresh button for when the user
 * just installed the binary and wants to re-check without reopening the
 * panel. The error message comes straight from the Rust side — it
 * already tailors the hint (macOS quarantine, missing binary, etc).
 */
function ClaudeCliStatusPill() {
  const { t } = useTranslation()
  const [state, setState] = useState<"loading" | "ok" | "err">("loading")
  const [result, setResult] = useState<DetectResult | null>(null)

  async function detect() {
    setState("loading")
    if (!isTauri()) {
      setResult({ installed: false, version: null, path: null, error: t("settings.sections.llm.cliStatus.desktopOnly") })
      setState("err")
      return
    }
    try {
      const r = await invoke<DetectResult>("claude_cli_detect")
      setResult(r)
      setState(r.installed ? "ok" : "err")
    } catch (e) {
      setResult({
        installed: false,
        version: null,
        path: null,
        error: e instanceof Error ? e.message : String(e),
      })
      setState("err")
    }
  }

  useEffect(() => {
    void detect()
  }, [])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="m-0">{t("settings.sections.llm.cliStatus.title")}</Label>
        <button
          type="button"
          onClick={() => void detect()}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          disabled={state === "loading"}
        >
          {state === "loading"
            ? t("settings.sections.llm.cliStatus.checking")
            : t("settings.sections.llm.cliStatus.recheck")}
        </button>
      </div>
      <div
        className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
          state === "ok"
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
            : state === "err"
              ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400"
              : "border-border bg-background/50 text-muted-foreground"
        }`}
      >
        {state === "loading" && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
        {state === "ok" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        {state === "err" && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-0.5">
          {state === "loading" && <div>{t("settings.sections.llm.cliStatus.claudeDetecting")}</div>}
          {state === "ok" && (
            <>
              <div>
                {t("settings.sections.llm.cliStatus.claudeReady", {
                  versionSuffix: result?.version ? ` ${result.version}` : "",
                })}
              </div>
              {result?.path && (
                <div className="truncate font-mono text-[0.625rem] text-muted-foreground">
                  {result.path}
                </div>
              )}
              {/* `claude --version` doesn't validate OAuth, so even a
                  green pill can hide an expired login. Surface the
                  remediation up front so users don't mis-diagnose
                  the resulting "Unauthenticated" exit-1 as a LLM
                  Wiki bug. */}
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliStatus.authErrorPrefix")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.625rem]">
                  claude
                </code>{" "}
                {t("settings.sections.llm.cliStatus.claudeAuthErrorSuffix")}
              </div>
            </>
          )}
          {state === "err" && (
            <>
              <div>{result?.error ?? t("settings.sections.llm.cliStatus.claudeUnavailable")}</div>
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliStatus.installPrefix")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.625rem]">
                  npm i -g @anthropic-ai/claude-code
                </code>{" "}
                {t("settings.sections.llm.cliStatus.installSuffix")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CodexCliStatusPill() {
  const { t } = useTranslation()
  const [state, setState] = useState<"loading" | "ok" | "err">("loading")
  const [result, setResult] = useState<DetectResult | null>(null)

  async function detect() {
    setState("loading")
    if (!isTauri()) {
      setResult({ installed: false, version: null, path: null, error: t("settings.sections.llm.cliStatus.desktopOnly") })
      setState("err")
      return
    }
    try {
      const r = await invoke<DetectResult>("codex_cli_detect")
      setResult(r)
      setState(r.installed && r.appServerReady === true && r.dynamicToolsReady === true ? "ok" : "err")
    } catch (e) {
      setResult({
        installed: false,
        version: null,
        path: null,
        error: e instanceof Error ? e.message : String(e),
      })
      setState("err")
    }
  }

  useEffect(() => {
    void detect()
  }, [])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="m-0">{t("settings.sections.llm.cliStatus.title")}</Label>
        <button
          type="button"
          onClick={() => void detect()}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          disabled={state === "loading"}
        >
          {state === "loading"
            ? t("settings.sections.llm.cliStatus.checking")
            : t("settings.sections.llm.cliStatus.recheck")}
        </button>
      </div>
      <div
        className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
          state === "ok"
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
            : state === "err"
              ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400"
              : "border-border bg-background/50 text-muted-foreground"
        }`}
      >
        {state === "loading" && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
        {state === "ok" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        {state === "err" && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-0.5">
          {state === "loading" && <div>{t("settings.sections.llm.cliStatus.codexDetecting")}</div>}
          {state === "ok" && (
            <>
              <div>
                {t("settings.sections.llm.cliStatus.codexReady", {
                  versionSuffix: result?.version ? ` ${result.version}` : "",
                })}
              </div>
              {result?.path && (
                <div className="truncate font-mono text-[0.625rem] text-muted-foreground">
                  {result.path}
                </div>
              )}
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliStatus.authErrorPrefix")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.625rem]">
                  codex
                </code>{" "}
                {t("settings.sections.llm.cliStatus.codexAuthErrorSuffix")}
              </div>
            </>
          )}
          {state === "err" && (
            <>
              <div>{result?.error ?? t("settings.sections.llm.cliStatus.codexUnavailable")}</div>
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliStatus.installPrefix")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.625rem]">
                  npm install -g @openai/codex
                </code>{" "}
                {t("settings.sections.llm.cliStatus.installSuffix")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CursorCliStatusPill() {
  const { t } = useTranslation()
  const [state, setState] = useState<"loading" | "ok" | "err">("loading")
  const [agent, setAgent] = useState<DetectResult | null>(null)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const [proxyHealthy, setProxyHealthy] = useState(false)
  const [proxyBase, setProxyBase] = useState<string | null>(null)
  const [agentAction, setAgentAction] = useState<"idle" | "checking" | "updating">("idle")
  const [updateNote, setUpdateNote] = useState<{
    kind: "ok" | "info" | "err"
    text: string
  } | null>(null)

  const actionBusy = agentAction !== "idle"

  async function detect(opts?: { silent?: boolean }) {
    if (!opts?.silent) {
      setState("loading")
      setProxyError(null)
    }
    if (!isTauri()) {
      setAgent({
        installed: false,
        version: null,
        path: null,
        error: t("settings.sections.llm.cliStatus.desktopOnly"),
      })
      setProxyHealthy(false)
      setState("err")
      return
    }
    try {
      const { detectCursorCli, getCursorProxyStatus, ensureCursorProxyRunning } =
        await import("@/lib/cursor-cli-proxy")
      const agentResult = await detectCursorCli()
      setAgent(agentResult)

      let status = await getCursorProxyStatus()
      let ensureError: string | null = null
      try {
        const endpoint = await ensureCursorProxyRunning(
          { provider: "cursor-cli" },
          { forceRestart: true },
        )
        status = await getCursorProxyStatus()
        setProxyBase(status.base_url || endpoint.replace(/\/v1$/i, ""))
      } catch (e) {
        ensureError = e instanceof Error ? e.message : String(e)
      }
      setProxyHealthy(status.healthy)
      setProxyError(ensureError ?? (status.healthy ? null : status.error))
      if (status.base_url) setProxyBase(status.base_url)

      const ok = agentResult.installed && status.healthy
      setState(ok ? "ok" : "err")
    } catch (e) {
      setAgent({
        installed: false,
        version: null,
        path: null,
        error: e instanceof Error ? e.message : String(e),
      })
      setProxyHealthy(false)
      setState("err")
    }
  }

  async function checkAgentUpdate() {
    if (actionBusy) return
    setAgentAction("checking")
    setUpdateNote(null)
    try {
      const { checkCursorAgentUpdate } = await import("@/lib/cursor-cli-proxy")
      const about = await checkCursorAgentUpdate()
      if (about.version) {
        setAgent((prev) => ({
          installed: true,
          version: about.version,
          path: about.path ?? prev?.path ?? null,
          error: about.error,
        }))
      }
      if (!about.installed) {
        setUpdateNote({
          kind: "err",
          text: about.error ?? t("settings.sections.llm.cliStatus.cursorAgentUnavailable"),
        })
        return
      }
      if (about.latest_status === "up_to_date") {
        setUpdateNote({
          kind: "ok",
          text: t("settings.sections.llm.cliStatus.cursorLatestUpToDate"),
        })
        return
      }
      if (about.latest_status === "update_available") {
        setUpdateNote({
          kind: "info",
          text: t("settings.sections.llm.cliStatus.cursorLatestAvailable", {
            version: about.latest_version ?? "?",
          }),
        })
        return
      }
      setUpdateNote({
        kind: "err",
        text: about.error ?? t("settings.sections.llm.cliStatus.cursorLatestUnknown"),
      })
    } catch (e) {
      setUpdateNote({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setAgentAction("idle")
    }
  }

  async function runAgentUpdate() {
    if (actionBusy) return
    setAgentAction("updating")
    setUpdateNote(null)
    try {
      const { updateCursorAgent } = await import("@/lib/cursor-cli-proxy")
      const result = await updateCursorAgent()
      if (result.ok) {
        setUpdateNote({
          kind: "ok",
          text: t("settings.sections.llm.cliStatus.cursorUpdateOk", {
            version: result.version ?? "?",
          }),
        })
        await detect({ silent: true })
        return
      }
      const busy = /already running/i.test(result.error ?? "")
      setUpdateNote({
        kind: "err",
        text: busy
          ? t("settings.sections.llm.cliStatus.cursorUpdateBusy")
          : t("settings.sections.llm.cliStatus.cursorUpdateFailed", {
              message: result.error ?? result.output,
            }),
      })
    } catch (e) {
      setUpdateNote({
        kind: "err",
        text: t("settings.sections.llm.cliStatus.cursorUpdateFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      })
    } finally {
      setAgentAction("idle")
    }
  }

  useEffect(() => {
    void detect()
  }, [])

  const pillBusy = state === "loading" || actionBusy

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="m-0">{t("settings.sections.llm.cliStatus.title")}</Label>
        <button
          type="button"
          onClick={() => void detect()}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          disabled={pillBusy}
        >
          {state === "loading"
            ? t("settings.sections.llm.cliStatus.checking")
            : t("settings.sections.llm.cliStatus.recheck")}
        </button>
        {agent?.installed && (
          <>
            <button
              type="button"
              onClick={() => void checkAgentUpdate()}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              disabled={pillBusy}
            >
              {t("settings.sections.llm.cliStatus.cursorCheckUpdate")}
            </button>
            <button
              type="button"
              onClick={() => void runAgentUpdate()}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              disabled={pillBusy}
            >
              {t("settings.sections.llm.cliStatus.cursorUpdateNow")}
            </button>
          </>
        )}
      </div>
      <div
        className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
          state === "ok"
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
            : state === "err"
              ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400"
              : "border-border bg-background/50 text-muted-foreground"
        }`}
      >
        {state === "loading" && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
        {state === "ok" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        {state === "err" && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-0.5">
          {state === "loading" && <div>{t("settings.sections.llm.cliStatus.cursorDetecting")}</div>}
          {state !== "loading" && (
            <>
              <div>
                {agent?.installed
                  ? t("settings.sections.llm.cliStatus.cursorAgentReady", {
                      versionSuffix: agent.version ? ` ${agent.version}` : "",
                    })
                  : (agent?.error ?? t("settings.sections.llm.cliStatus.cursorAgentUnavailable"))}
              </div>
              {agent?.path && (
                <div className="truncate font-mono text-[0.625rem] text-muted-foreground">
                  {agent.path}
                </div>
              )}
              <div>
                {proxyHealthy
                  ? t("settings.sections.llm.cliStatus.cursorProxyReady", {
                      baseUrl: proxyBase ?? "",
                    })
                  : (proxyError ?? t("settings.sections.llm.cliStatus.cursorProxyUnavailable"))}
              </div>
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliStatus.authErrorPrefix")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.625rem]">
                  agent login
                </code>{" "}
                {t("settings.sections.llm.cliStatus.cursorAuthErrorSuffix")}
              </div>
              {agent?.installed && (
                <div className="text-muted-foreground">
                  {t("settings.sections.llm.cliStatus.cursorUpdatePrefix")}{" "}
                  <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.625rem]">
                    agent update
                  </code>{" "}
                  {t("settings.sections.llm.cliStatus.cursorUpdateSuffix")}
                </div>
              )}
              {agentAction === "checking" && (
                <div className="text-muted-foreground">
                  {t("settings.sections.llm.cliStatus.cursorUpdateChecking")}
                </div>
              )}
              {agentAction === "updating" && (
                <div className="text-muted-foreground">
                  {t("settings.sections.llm.cliStatus.cursorUpdating")}
                </div>
              )}
              {updateNote && (
                <div
                  className={
                    updateNote.kind === "err"
                      ? "text-rose-700 dark:text-rose-400"
                      : updateNote.kind === "ok"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground"
                  }
                >
                  {updateNote.text}
                </div>
              )}
              {!agent?.installed && (
                <div className="text-muted-foreground">
                  {t("settings.sections.llm.cliStatus.installPrefix")}{" "}
                  <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.625rem]">
                    curl https://cursor.com/install -fsS | bash
                  </code>{" "}
                  {t("settings.sections.llm.cliStatus.installSuffix")}
                </div>
              )}
              {agent?.installed && !proxyHealthy && (
                <div className="text-muted-foreground">
                  {t("settings.sections.llm.cliStatus.cursorProxyNpxHint")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

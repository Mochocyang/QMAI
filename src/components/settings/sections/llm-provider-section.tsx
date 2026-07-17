import { useEffect, useMemo, useState, useRef } from "react"
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore, type ProviderOverride, type ReasoningConfig, type ReasoningMode, type SavedModel } from "@/stores/wiki-store"
import { LLM_PRESETS, type LlmPreset } from "../llm-presets"
import { ContextSizeSelector } from "../context-size-selector"
import { resolveConfig } from "../preset-resolver"
import { normalizeEndpoint } from "@/lib/endpoint-normalizer"
import { isTauri } from "@/lib/platform"
import { AZURE_OPENAI_API_VERSION } from "@/lib/azure-openai"
import { testLlmConnection, testLlmFunction, type ProviderTestResult } from "@/lib/connection-tests"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import { useBatchModelTest } from "../hooks/use-batch-model-test"
import { ModelSelectInput } from "../model-select-input"
import { SavedModelsManager } from "./saved-models-manager"
import { CustomProviderCards } from "./custom-provider-cards"

export function LlmProviderSection() {
  const { t } = useTranslation()
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const setProviderConfigs = useWikiStore((s) => s.setProviderConfigs)
  const activePresetId = useWikiStore((s) => s.activePresetId)
  const setActivePresetId = useWikiStore((s) => s.setActivePresetId)
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig)
  const llmConfig = useWikiStore((s) => s.llmConfig)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [savedId, setSavedId] = useState<string | null>(null)

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  async function persist(newConfigs: typeof providerConfigs, newActive: string | null) {
    const { saveProviderConfigs, saveActivePresetId, saveLlmConfig } = await import(
      "@/lib/project-store"
    )
    await saveProviderConfigs(newConfigs)
    await saveActivePresetId(newActive)
    if (newActive) {
      const preset = LLM_PRESETS.find((p) => p.id === newActive)
      if (preset) {
        const resolved = resolveConfig(preset, newConfigs[newActive], llmConfig)
        setLlmConfig(resolved)
        await saveLlmConfig(resolved)
      }
    }
  }

  function updateOverride(id: string, patch: ProviderOverride) {
    const merged: ProviderOverride = { ...(providerConfigs[id] ?? {}), ...patch }
    const next = { ...providerConfigs, [id]: merged }
    setProviderConfigs(next)
    persist(next, activePresetId).catch(() => {})
    // If this preset is active, refresh the resolved LlmConfig live.
    if (id === activePresetId) {
      const preset = LLM_PRESETS.find((p) => p.id === id)
      if (preset) setLlmConfig(resolveConfig(preset, merged, llmConfig))
    }
    setSavedId(id)
    setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1500)
  }

  function toggleActive(id: string) {
    const next = id === activePresetId ? null : id
    setActivePresetId(next)
    persist(providerConfigs, next).catch(() => {})
  }

  function toggleEnabled(id: string) {
    const current = providerConfigs[id]
    const currentEnabled = current?.enabled === true
    const merged: ProviderOverride = { ...(current ?? {}), enabled: !currentEnabled }
    const next = { ...providerConfigs, [id]: merged }
    setProviderConfigs(next)
    persist(next, activePresetId).catch(() => {})
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.llm.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.llm.description")}
        </p>
      </div>

      {/* Custom Provider Cards - 放在顶部 */}
      <CustomProviderCards />

      {/* Built-in Presets - 内置预设，过滤掉通用的"自定义模型"预设 */}
      <div className="space-y-2">
        {LLM_PRESETS.filter((p) => p.id !== "custom").map((preset) => {
          const ov = providerConfigs[preset.id]
          return (
            <PresetRow
              key={preset.id}
              preset={preset}
              override={ov}
              isActive={activePresetId === preset.id}
              isEnabled={ov?.enabled === true}
              isExpanded={!!expanded[preset.id]}
              savedHere={savedId === preset.id}
              onToggleActive={() => toggleActive(preset.id)}
              onToggleEnabled={() => toggleEnabled(preset.id)}
              onToggleExpand={() => toggleExpand(preset.id)}
              onChange={(patch) => updateOverride(preset.id, patch)}
            />
          )
        })}
      </div>
    </div>
  )
}

interface PresetRowProps {
  preset: LlmPreset
  override: ProviderOverride | undefined
  isActive: boolean
  isEnabled: boolean
  isExpanded: boolean
  savedHere: boolean
  onToggleActive: () => void
  onToggleEnabled: () => void
  onToggleExpand: () => void
  onChange: (patch: ProviderOverride) => void
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
  savedHere,
  onToggleActive: _onToggleActive,
  onToggleEnabled,
  onToggleExpand,
  onChange,
}: PresetRowProps) {
  const { t } = useTranslation()
  const ov = override ?? {}
  const model = ov.model?.trim() || preset.defaultModel || ""
  const apiKey = ov.apiKey ?? ""
  const apiMode = ov.apiMode ?? preset.apiMode ?? "chat_completions"
  const baseUrl = ov.baseUrl ?? preset.baseUrl ?? ""
  const azureApiVersion = ov.azureApiVersion ?? preset.azureApiVersion ?? AZURE_OPENAI_API_VERSION
  const azureModelFamily = ov.azureModelFamily ?? preset.azureModelFamily ?? "auto"
  const context = ov.maxContextSize ?? preset.suggestedContextSize ?? 131072
  const reasoning = ov.reasoning ?? { mode: "auto" as const }
  const localCliIsolation = ov.localCliIsolation === true
  const codexCliTimeoutMinutes = Math.max(1, Math.min(240, ov.codexCliTimeoutMinutes ?? 10))
  const isLocalCliProvider = preset.provider === "claude-code" || preset.provider === "codex-cli"
  const isCursorCliProvider = preset.provider === "cursor-cli"
  const [testState, setTestState] = useState<ProviderTestState>({ kind: "idle" })
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelListState, setModelListState] = useState<ModelActionState>(null)
  const [isModelSelectionExpanded, setIsModelSelectionExpanded] = useState(false)
  const savedModelsTextareaRef = useRef<HTMLTextAreaElement>(null)
  const { modelTestState, runBatchTest, retryFailed } = useBatchModelTest(t)
  const hasConfig = !!apiKey || !!ov.baseUrl || !!ov.model || !!ov.azureApiVersion || !!ov.azureModelFamily
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

  async function runProviderTest(kind: "connection" | "function") {
    setTestState({
      kind: "running",
      label: kind === "connection"
        ? t("settings.sections.llm.testingConnection")
        : t("settings.sections.llm.testingFunction"),
    })
    const result = kind === "connection"
      ? await testLlmConnection(resolvedConfig)
      : await testLlmFunction(resolvedConfig)
    setTestState({ kind: "done", result })
  }

  async function loadModelOptions() {
    setModelListState({
      loading: true,
      success: false,
      message: t("settings.sections.shared.loadingModels"),
    })

    try {
      const result = await fetchLlmModelList(resolvedConfig)
      setModelOptions(result.models)

      // 拉取成功后自动展开模型选择区域
      setIsModelSelectionExpanded(true)

      setModelListState({
        loading: false,
        success: true,
        message: t("settings.sections.shared.modelListSuccess", { count: result.models.length }),
      })
    } catch (error) {
      setModelListState({
        loading: false,
        success: false,
        message: t("settings.sections.shared.modelListFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    }
  }

  function toggleModelSelection(modelId: string) {
    const currentSaved = ov.savedModels ?? []
    const isSelected = currentSaved.some((m) => m.model === modelId)

    let updatedModels: SavedModel[]

    if (isSelected) {
      updatedModels = currentSaved.filter((m) => m.model !== modelId)
    } else {
      const newModel: SavedModel = {
        id: `model-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: modelId,
        model: modelId,
        apiKey: apiKey || undefined,
        // Cursor CLI endpoint is managed dynamically — never bake 8765 into saved models.
        customEndpoint: isCursorCliProvider ? undefined : (baseUrl || undefined),
        createdAt: Date.now(),
      }
      updatedModels = [...currentSaved, newModel]
    }

    onChange({ savedModels: updatedModels })
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
      {/* Outer row — always visible */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggleExpand}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
          title={isExpanded ? t("settings.sections.llm.collapse") : t("settings.sections.llm.expand")}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{preset.label}</span>
            {hasConfig && !isEnabled && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t("settings.sections.llm.configuredBadge")}
              </span>
            )}
            {isEnabled && (ov.savedModels ?? []).length > 0 && (
              <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {t("settings.sections.llm.enabledBadge", { count: (ov.savedModels ?? []).length })}
              </span>
            )}
            {savedHere && (
              <span className="shrink-0 text-[10px] text-emerald-600">{t("settings.sections.llm.savedBadge")}</span>
            )}
          </div>
          {preset.hint && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {preset.hint}
            </div>
          )}
        </button>

        {/* Toggle switch — 启用/停用 */}
        <button
          type="button"
          onClick={onToggleEnabled}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
            isEnabled
              ? "border-primary bg-primary"
              : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
          }`}
          title={isEnabled ? t("settings.sections.llm.toggleOff") : t("settings.sections.llm.toggleOn")}
          aria-label={isEnabled ? t("settings.sections.llm.deactivate") : t("settings.sections.llm.activate")}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
              isEnabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Expanded config panel */}
      {isExpanded && (
        <div className="space-y-4 border-t bg-background/50 px-4 py-3">
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

          {isLocalCliProvider && (
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
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => onChange({ apiKey: e.target.value })}
                placeholder={
                  preset.provider === "custom"
                    ? t("settings.sections.llm.apiKeyPlaceholderCustom")
                    : t("settings.sections.llm.apiKeyPlaceholder")
                }
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>
              {preset.provider === "azure"
                ? t("settings.sections.llm.deploymentName", "Deployment name")
                : t("settings.sections.llm.model")}
            </Label>
            <ModelPicker
              value={model}
              suggestions={preset.suggestedModels ?? []}
              fetchedModels={modelOptions}
              placeholder={preset.defaultModel ?? "e.g. gpt-4o"}
              selectPlaceholder={t("settings.sections.shared.modelSelectPlaceholder")}
              inputPlaceholder={t("settings.sections.shared.modelManualPlaceholder")}
              onChange={(v) => onChange({ model: v })}
            />
          </div>

          {/* 拉取模型后的多选标签区域 */}
          {modelOptions.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsModelSelectionExpanded(!isModelSelectionExpanded)}
                  className="flex items-center gap-2 text-xs font-medium hover:text-primary"
                >
                  <span>{t("settings.sections.llm.fetchedModelsCount", { count: modelOptions.length })}</span>
                  <span className="text-muted-foreground">{t("settings.sections.llm.selectedModelsCount", { count: (ov.savedModels ?? []).length })}</span>
                </button>
              </div>

              {isModelSelectionExpanded && (
                <>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.sections.llm.toggleModelHint")}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {modelOptions.map((modelId) => {
                      const isSelected = (ov.savedModels ?? []).some((m) => m.model === modelId)
                      return (
                        <button
                          key={modelId}
                          type="button"
                          onClick={() => toggleModelSelection(modelId)}
                          className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background hover:bg-accent"
                          }`}
                        >
                          {modelId}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 已选模型显示 */}
          {(ov.savedModels ?? []).length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">{t("settings.sections.llm.selectedModels")}</Label>
              <textarea
                ref={savedModelsTextareaRef}
                value={(ov.savedModels ?? []).map((m) => m.model).join(", ")}
                readOnly
                placeholder={t("settings.sections.llm.pleaseFetchModels")}
                className="flex min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                rows={1}
              />
            </div>
          )}

          <SavedModelsManager
            savedModels={ov.savedModels ?? []}
            onChange={(models) => onChange({ savedModels: models })}
            hideEndpoint={isCursorCliProvider}
            buildTestConfig={(saved) => ({
              ...resolvedConfig,
              model: saved.model,
              apiKey: saved.apiKey?.trim() || resolvedConfig.apiKey,
              // Cursor CLI ignores saved endpoints; other providers may override.
              customEndpoint: isCursorCliProvider
                ? resolvedConfig.customEndpoint
                : (saved.customEndpoint?.trim() || resolvedConfig.customEndpoint),
            })}
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
                {modelListState.message}
              </p>
            ) : null}
            {modelTestState?.message ? (
              <div className="space-y-1.5">
                <p className={`text-xs ${modelTestState.success ? "text-emerald-600" : "text-destructive"}`}>
                  {modelTestState.message}
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

          <ReasoningControls
            value={reasoning}
            onChange={(reasoning) => onChange({ reasoning })}
          />

          <div className="space-y-2 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">
                {t("settings.sections.llm.providerTests")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.sections.llm.providerTestsHint")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runProviderTest("connection")}
                disabled={testState.kind === "running"}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("settings.sections.llm.testConnection")}
              </button>
              <button
                type="button"
                onClick={() => void runProviderTest("function")}
                disabled={testState.kind === "running"}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("settings.sections.llm.testFunction")}
              </button>
            </div>
            {testState.kind === "running" && (
              <p className="text-xs text-muted-foreground">{testState.label}</p>
            )}
            {testState.kind === "done" && (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  testState.result.ok
                    ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                    : "border-destructive/40 bg-destructive/5 text-destructive"
                }`}
              >
                {testState.result.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ReasoningControls({
  value,
  onChange,
}: {
  value: ReasoningConfig
  onChange: (value: ReasoningConfig) => void
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
              onClick={() => onChange({ ...value, mode: m.value })}
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

interface ModelPickerProps {
  value: string
  suggestions: string[]
  fetchedModels: string[]
  placeholder: string
  selectPlaceholder: string
  inputPlaceholder: string
  onChange: (value: string) => void
}

/**
 * Model input with a chip-based suggestion row above it. The input stays
 * free-text so users can always type unlisted models (fine-tunes, preview
 * IDs, local Ollama tags, etc.). Clicking a chip just fills the input.
 *
 * The currently-selected chip (if the value matches one of the suggestions)
 * gets the accent highlight so users can see at a glance which preset
 * model is active without reading the text field. Presets with no
 * `suggestedModels` render the input alone.
 */
function ModelPicker({
  value,
  suggestions,
  fetchedModels,
  placeholder,
  selectPlaceholder,
  inputPlaceholder,
  onChange,
}: ModelPickerProps) {
  const { t } = useTranslation()
  const hasSuggestions = suggestions.length > 0
  const isCustom = hasSuggestions && value.length > 0 && !suggestions.includes(value)
  const mergedOptions = useMemo(
    () => Array.from(new Set([...fetchedModels, value].map((item) => item.trim()).filter(Boolean))),
    [fetchedModels, value],
  )

  return (
    <div className="space-y-2">
      {hasSuggestions && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((m) => {
            const active = m === value
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange(m)}
                className={`rounded-md border px-2 py-0.5 text-xs font-mono transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent hover:text-accent-foreground"
                }`}
                title={t("settings.sections.llm.useModel", { model: m })}
              >
                {m}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => onChange("")}
            className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
              isCustom
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
            title={t("settings.sections.llm.typeCustomModel")}
          >
            {isCustom
              ? t("settings.sections.llm.customModelBadge", { model: value })
              : t("settings.sections.llm.customModel")}
          </button>
        </div>
      )}
      <ModelSelectInput
        value={value}
        options={mergedOptions}
        onChange={onChange}
        selectPlaceholder={selectPlaceholder}
        inputPlaceholder={inputPlaceholder || placeholder}
      />
    </div>
  )
}

interface DetectResult {
  installed: boolean
  version: string | null
  path: string | null
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
                <div className="truncate font-mono text-[10px] text-muted-foreground">
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
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
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
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
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
          {state === "loading" && <div>{t("settings.sections.llm.cliStatus.codexDetecting")}</div>}
          {state === "ok" && (
            <>
              <div>
                {t("settings.sections.llm.cliStatus.codexReady", {
                  versionSuffix: result?.version ? ` ${result.version}` : "",
                })}
              </div>
              {result?.path && (
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {result.path}
                </div>
              )}
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliStatus.authErrorPrefix")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
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
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
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

  async function detect() {
    setState("loading")
    setProxyError(null)
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
                <div className="truncate font-mono text-[10px] text-muted-foreground">
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
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
                  agent login
                </code>{" "}
                {t("settings.sections.llm.cliStatus.cursorAuthErrorSuffix")}
              </div>
              {!agent?.installed && (
                <div className="text-muted-foreground">
                  {t("settings.sections.llm.cliStatus.installPrefix")}{" "}
                  <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
                    curl https://cursor.com/install -fsS | bash
                  </code>{" "}
                  {t("settings.sections.llm.cliStatus.installSuffix")}
                </div>
              )}
              {agent?.installed && !proxyHealthy && (
                <div className="text-muted-foreground">
                  {t("settings.sections.llm.cliStatus.installPrefix")}{" "}
                  <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
                    npx cursor-api-proxy
                  </code>{" "}
                  {t("settings.sections.llm.cliStatus.installSuffix")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

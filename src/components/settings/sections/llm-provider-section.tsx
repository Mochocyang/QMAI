import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore, type ProviderOverride, type ReasoningConfig, type ReasoningMode } from "@/stores/wiki-store"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import { LLM_PRESETS, type LlmPreset } from "../llm-presets"
import { ContextSizeSelector } from "../context-size-selector"
import { ModelSelectInput } from "../model-select-input"
import { ResourceLink } from "../resource-link"
import { resolveConfig } from "../preset-resolver"
import { isTauri } from "@/lib/platform"
import { normalizeEndpoint } from "@/lib/endpoint-normalizer"
import { testSettingsLlmModel } from "@/lib/settings-model-test"

const BAILIAN_FREE_MODEL_URL = "https://bailian.console.aliyun.com/"

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
    if (next === id) {
      setExpanded((prev) => ({ ...prev, [id]: true }))
    } else {
      setExpanded((prev) => ({ ...prev, [id]: false }))
    }
    persist(providerConfigs, next).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.llm.title")}</h2>
      </div>

      <div className="space-y-2">
        {LLM_PRESETS.map((preset) => (
          <PresetRow
            key={preset.id}
            preset={preset}
            override={providerConfigs[preset.id]}
            isActive={activePresetId === preset.id}
            isExpanded={!!expanded[preset.id]}
            savedHere={savedId === preset.id}
            onToggleActive={() => toggleActive(preset.id)}
            onToggleExpand={() => toggleExpand(preset.id)}
            onChange={(patch) => updateOverride(preset.id, patch)}
          />
        ))}
      </div>
    </div>
  )
}

interface PresetRowProps {
  preset: LlmPreset
  override: ProviderOverride | undefined
  isActive: boolean
  isExpanded: boolean
  savedHere: boolean
  onToggleActive: () => void
  onToggleExpand: () => void
  onChange: (patch: ProviderOverride) => void
}

function PresetRow({
  preset,
  override,
  isActive,
  isExpanded,
  savedHere,
  onToggleActive,
  onToggleExpand,
  onChange,
}: PresetRowProps) {
  const { t } = useTranslation()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const ov = override ?? {}
  const model = ov.model ?? preset.defaultModel ?? ""
  const apiKey = ov.apiKey ?? ""
  const apiMode = ov.apiMode ?? preset.apiMode ?? "chat_completions"
  const baseUrl = ov.baseUrl ?? preset.baseUrl ?? ""
  const context = ov.maxContextSize ?? preset.suggestedContextSize ?? 131072
  const reasoning = ov.reasoning ?? { mode: "auto" as const }
  const hasConfig = !!apiKey || !!ov.baseUrl || !!ov.model
  // Local CLI providers authenticate via their own existing login state
  // (inherited by the spawned subprocess), so no API key field is shown.
  // Ollama ditto for its local-only model.
  const needsApiKey =
    preset.provider !== "ollama" &&
    preset.provider !== "claude-code" &&
    preset.provider !== "codex-cli"
  const [testState, setTestState] = useState<{
    loading: boolean
    success: boolean
    message: string
  } | null>(null)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelListState, setModelListState] = useState<{
    loading: boolean
    success: boolean
    message: string
  } | null>(null)

  useEffect(() => {
    setModelOptions([])
    setModelListState(null)
  }, [preset.provider, baseUrl, apiKey, apiMode])

  async function handleTest() {
    const config = resolveConfig(preset, override, llmConfig)
    const hasModel = config.model.trim().length > 0

    if (hasModel) {
      setTestState({
        loading: true,
        success: false,
        message: t("settings.sections.shared.testing"),
      })

      try {
        const result = await testSettingsLlmModel(config)
        setTestState({
          loading: false,
          success: true,
          message: t("settings.sections.shared.testSuccessWithModel", { model: result.model }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setTestState({
          loading: false,
          success: false,
          message: t("settings.sections.shared.testFailed", {
            message,
          }),
        })
        return
      }
    } else {
      setTestState(null)
    }

    setModelListState({
      loading: true,
      success: false,
      message: t("settings.sections.shared.loadingModels"),
    })

    try {
      const modelList = await fetchLlmModelList(config)
      setModelOptions(modelList.models)
      setModelListState({
        loading: false,
        success: true,
        message: t("settings.sections.shared.modelListSuccess", { count: modelList.models.length }),
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

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isActive ? "border-primary/60 bg-primary/5" : "border-border"
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
            {hasConfig && !isActive && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t("settings.sections.llm.configuredBadge")}
              </span>
            )}
            {isActive && (
              <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {t("settings.sections.llm.activeBadge")}
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

        {/* Toggle switch */}
        <button
          type="button"
          onClick={onToggleActive}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
            isActive
              ? "border-primary bg-primary"
              : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
          }`}
          title={isActive ? t("settings.sections.llm.toggleOff") : t("settings.sections.llm.toggleOn")}
          aria-label={isActive ? t("settings.sections.llm.deactivate") : t("settings.sections.llm.activate")}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
              isActive ? "translate-x-4" : "translate-x-0.5"
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

          {(preset.provider === "custom" || preset.provider === "ollama") && (
            <EndpointField
              value={baseUrl}
              mode={apiMode}
              placeholder={preset.baseUrl ?? "https://your-api.example.com/v1"}
              onChange={(v) => onChange({ baseUrl: v })}
            />
          )}

          {preset.provider === "claude-code" && <ClaudeCliStatusPill />}
          {preset.provider === "codex-cli" && <CodexCliStatusPill />}

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
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={testState?.loading || modelListState?.loading}
              onClick={() => void handleTest()}
            >
              {testState?.loading || modelListState?.loading
                ? t("settings.sections.shared.testing")
                : t("settings.sections.shared.testModel")}
            </Button>
            {testState?.message ? (
              <p className={`text-xs ${testState.success ? "text-emerald-600" : "text-destructive"}`}>
                {testState.message}
              </p>
            ) : null}
            {modelListState?.message ? (
              <p className={`text-xs ${modelListState.success ? "text-emerald-600" : "text-destructive"}`}>
                {modelListState.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{t("settings.sections.llm.model")}</Label>
            <ModelSelectInput
              value={model}
              options={[...(preset.suggestedModels ?? []), ...modelOptions]}
              selectPlaceholder={t("settings.sections.shared.modelSelectPlaceholder")}
              inputPlaceholder={t("settings.sections.shared.modelManualPlaceholder")}
              onChange={(v) => onChange({ model: v })}
            />
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
        </div>
      )}
    </div>
  )
}

function ReasoningControls({
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
  mode: "chat_completions" | "anthropic_messages"
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
      <div className="flex flex-wrap items-center gap-2">
        <Label>{t("settings.sections.llm.endpoint")}</Label>
        <ResourceLink
          href={BAILIAN_FREE_MODEL_URL}
          title="阿里百炼提供通义系列模型和免费额度，适合作为自定义 OpenAI 兼容接口。"
        >
          阿里百炼免费模型
        </ResourceLink>
      </div>
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
                  {preview.normalized || t("settings.sections.llm.emptyValue")}
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
      const { invoke } = await import("@tauri-apps/api/core")
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
      const { invoke } = await import("@tauri-apps/api/core")
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

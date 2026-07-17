import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore } from "@/stores/wiki-store"
import { fetchRerankModelList } from "@/lib/settings-model-list"
import { testSettingsRerankModel } from "@/lib/settings-model-test"
import { normalizeEndpoint } from "@/lib/endpoint-normalizer"
import { ModelSelectInput } from "../model-select-input"
import { ResourceLink } from "../resource-link"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { CustomApiMode, LlmConfig, RerankConfig } from "@/stores/wiki-store"

const SILICONFLOW_RESOURCE_URL = "https://cloud.siliconflow.cn/i/1lKTd7hi"

function normalizeRerankEndpoint(raw: string, mode: CustomApiMode) {
  const trimmed = (raw ?? "").trim()
  if (/^https?:\/\//i.test(trimmed) && /\/rerank\/?$/i.test(trimmed)) {
    const normalized = trimmed.replace(/\/+$/, "")
    return {
      normalized,
      changed: normalized !== trimmed,
      warning: undefined,
    }
  }
  return normalizeEndpoint(raw, mode)
}

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

const PROVIDER_OPTIONS: Array<{ value: LlmConfig["provider"]; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "ollama", label: "Ollama" },
  { value: "custom", label: "\u81ea\u5b9a\u4e49" },
  { value: "minimax", label: "MiniMax" },
  { value: "claude-code", label: "Claude Code CLI" },
  { value: "codex-cli", label: "Codex CLI" },
  { value: "cursor-cli", label: "Cursor CLI" },
]

export function RerankSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const config = draft.rerankConfig
  const [expanded, setExpanded] = useState(false)
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

  const updateRerankConfig = (patch: Partial<RerankConfig>) => {
    setDraft("rerankConfig", { ...config, ...patch })
  }

  const needsApiKey =
    config.provider !== "ollama" &&
    config.provider !== "claude-code" &&
    config.provider !== "codex-cli" &&
    config.provider !== "cursor-cli"
  const hasConfig = config.useMainLlm || Boolean(config.model || config.customEndpoint || config.ollamaUrl)

  function handleOpenPanel() {
    setExpanded((prev) => !prev)
  }

  useEffect(() => {
    setModelOptions([])
    setModelListState(null)
  }, [config.useMainLlm, config.provider, config.apiKey, config.customEndpoint, config.ollamaUrl, config.apiMode])

  async function handleTestModel() {
    const hasModel = config.useMainLlm
      ? llmConfig.model.trim().length > 0
      : config.model.trim().length > 0

    if (hasModel) {
      setTestState({
        loading: true,
        success: false,
        message: t("settings.sections.shared.testing"),
      })

      try {
        const result = await testSettingsRerankModel(llmConfig, config)
        setTestState({
          loading: false,
          success: true,
          message: result.usedMainLlm
            ? t("settings.sections.rerank.testSuccessUsingMainModel", { model: result.model })
            : t("settings.sections.shared.testSuccessWithModel", { model: result.model }),
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
      const modelList = await fetchRerankModelList(llmConfig, config)
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
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.rerank.title")}</h2>
      </div>

      <div
        className={`rounded-lg border transition-colors ${
          config.enabled ? "border-primary/60 bg-primary/5" : "border-border"
        }`}
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
            title={expanded ? t("settings.sections.llm.collapse") : t("settings.sections.llm.expand")}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={handleOpenPanel}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{t("settings.sections.rerank.enableLabel")}</span>
              {hasConfig && !config.enabled && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t("settings.sections.llm.configuredBadge")}
                </span>
              )}
              {config.enabled && (
                <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {t("settings.sections.llm.activeBadge")}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {t("settings.sections.rerank.enableHint")}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              updateRerankConfig({ enabled: !config.enabled })
              if (!config.enabled) setExpanded(true)
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
              config.enabled
                ? "border-primary bg-primary"
                : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
            }`}
            title={config.enabled ? t("settings.sections.llm.toggleOff") : t("settings.sections.llm.toggleOn")}
            aria-label={config.enabled ? t("settings.sections.llm.deactivate") : t("settings.sections.llm.activate")}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                config.enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {expanded && (
          <div className="space-y-4 border-t bg-background/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {t("settings.sections.rerank.description")}
            </p>

            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label>{t("settings.sections.rerank.useMainLlm")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.rerank.useMainLlmHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateRerankConfig({ useMainLlm: !config.useMainLlm })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                  config.useMainLlm
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
                }`}
                title={config.useMainLlm ? t("settings.sections.llm.toggleOff") : t("settings.sections.llm.toggleOn")}
                aria-label={config.useMainLlm ? t("settings.sections.llm.deactivate") : t("settings.sections.llm.activate")}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                    config.useMainLlm ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="space-y-2">
              <Label>{t("settings.sections.rerank.maxCandidates")}</Label>
              <Input
                type="number"
                min={3}
                max={30}
                value={config.maxCandidates}
                onChange={(e) => updateRerankConfig({
                  maxCandidates: Math.max(3, Math.min(30, Number(e.target.value) || 3)),
                })}
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.rerank.maxCandidatesHint")}
              </p>
            </div>

            {!config.useMainLlm && (
              <>
                <div className="space-y-2">
                  <Label>{t("settings.sections.rerank.provider")}</Label>
                  <select
                    value={config.provider}
                    onChange={(e) => updateRerankConfig({ provider: e.target.value as LlmConfig["provider"] })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {PROVIDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {config.provider === "custom" && (
                  <div className="space-y-2">
                    <Label>{t("settings.sections.rerank.apiMode")}</Label>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { value: "chat_completions", labelKey: "settings.sections.rerank.wireOpenAi" },
                          { value: "anthropic_messages", labelKey: "settings.sections.rerank.wireAnthropic" },
                        ] as const
                      ).map((mode) => {
                        const active = (config.apiMode ?? "chat_completions") === mode.value
                        return (
                          <button
                            key={mode.value}
                            type="button"
                            onClick={() => updateRerankConfig({ apiMode: mode.value as CustomApiMode })}
                            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border hover:bg-accent"
                            }`}
                          >
                            {t(mode.labelKey)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {config.provider === "custom" && (
                  <RerankEndpointField
                    value={config.customEndpoint}
                    mode={config.apiMode ?? "chat_completions"}
                    placeholder="https://your-api.example.com/v1"
                    onChange={(value) => updateRerankConfig({ customEndpoint: value })}
                  />
                )}

                {config.provider === "ollama" && (
                  <div className="space-y-2">
                    <Label>{t("settings.sections.rerank.endpoint")}</Label>
                    <Input
                      value={config.ollamaUrl}
                      onChange={(e) => updateRerankConfig({ ollamaUrl: e.target.value })}
                      placeholder="http://127.0.0.1:11434"
                    />
                  </div>
                )}

                {needsApiKey && (
                  <div className="space-y-2">
                    <Label>{t("settings.sections.rerank.apiKey")}</Label>
                    <Input
                      type="password"
                      value={config.apiKey}
                      onChange={(e) => updateRerankConfig({ apiKey: e.target.value })}
                      placeholder={t("settings.sections.rerank.apiKeyPlaceholder")}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={testState?.loading || modelListState?.loading}
                    onClick={() => void handleTestModel()}
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
                  <Label>{t("settings.sections.rerank.model")}</Label>
                  <ModelSelectInput
                    value={config.model}
                    options={modelOptions}
                    onChange={(value) => updateRerankConfig({ model: value })}
                    selectPlaceholder={t("settings.sections.shared.modelSelectPlaceholder")}
                    inputPlaceholder={t("settings.sections.shared.modelManualPlaceholder")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("settings.sections.rerank.modelHint")}
                  </p>
                </div>
              </>
            )}

            {config.useMainLlm && (
              <div className="space-y-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={testState?.loading || modelListState?.loading}
                  onClick={() => void handleTestModel()}
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
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RerankEndpointField({
  value,
  mode,
  placeholder,
  onChange,
}: {
  value: string
  mode: CustomApiMode
  placeholder: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const preview = useMemo(() => normalizeRerankEndpoint(value, mode), [mode, value])

  function handleBlur() {
    if (preview.changed && preview.normalized !== value.trim()) {
      onChange(preview.normalized)
    }
  }

  const showHint = value.trim().length > 0 && (preview.changed || preview.warning)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label>{t("settings.sections.rerank.endpoint")}</Label>
        <ResourceLink
          href={SILICONFLOW_RESOURCE_URL}
          title="为什么选择硅基流动：国内访问稳定，模型列表完整，适合配置轻量重排模型降低成本。"
        >
          硅基流动重排模型
        </ResourceLink>
      </div>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
      />
      {showHint ? (
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
            {preview.changed ? (
              <div>
                {t("settings.sections.llm.endpointPreviewWillUse")}{" "}
                <span className="break-all font-mono">{preview.normalized}</span>
              </div>
            ) : null}
            {preview.warning ? <div>{preview.warning}</div> : null}
            {preview.changed ? <div>{t("settings.sections.llm.endpointPreviewAutoApply")}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

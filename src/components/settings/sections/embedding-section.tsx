import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore } from "@/stores/wiki-store"
import {
  dropLegacyVectorTable,
  embedAllPages,
  getEmbeddingCount,
  getLastEmbeddingError,
  legacyVectorRowCount,
} from "@/lib/embedding"
import { fetchEmbeddingModelList } from "@/lib/settings-model-list"
import { testSettingsEmbeddingModel } from "@/lib/settings-model-test"
import { ModelSelectInput } from "../model-select-input"
import { ResourceLink } from "../resource-link"
import type { SettingsDraft, DraftSetter } from "../settings-types"

const SILICONFLOW_RESOURCE_URL = "https://cloud.siliconflow.cn/i/1lKTd7hi"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

type ReindexState =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; count: number }

function parsePositiveInteger(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === "") return undefined
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

export function EmbeddingSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const embeddingConfig = useWikiStore((s) => s.embeddingConfig)

  const [expanded, setExpanded] = useState(false)
  const [chunkCount, setChunkCount] = useState<number | null>(null)
  const [legacyCount, setLegacyCount] = useState<number>(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [reindex, setReindex] = useState<ReindexState>({ kind: "idle" })
  const [legacyDropped, setLegacyDropped] = useState(false)
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

  const refreshStats = useCallback(async () => {
    if (!project) return
    try {
      const [chunks, legacy] = await Promise.all([
        getEmbeddingCount(project.path),
        legacyVectorRowCount(project.path),
      ])
      setChunkCount(chunks)
      setLegacyCount(legacy)
    } catch {
      setChunkCount(null)
    }
    setLastError(getLastEmbeddingError())
  }, [project])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  useEffect(() => {
    setModelOptions([])
    setModelListState(null)
  }, [draft.embeddingEndpoint, draft.embeddingApiKey])

  const handleReindex = useCallback(async () => {
    if (!project) return
    setReindex({ kind: "running", done: 0, total: 0 })
    const count = await embedAllPages(project.path, embeddingConfig, (done, total) => {
      setReindex({ kind: "running", done, total })
    })
    setReindex({ kind: "done", count })
    await refreshStats()
  }, [project, embeddingConfig, refreshStats])

  const handleDropLegacy = useCallback(async () => {
    if (!project) return
    await dropLegacyVectorTable(project.path)
    setLegacyCount(0)
    setLegacyDropped(true)
  }, [project])

  const showLegacyMigration =
    legacyCount > 0 && (chunkCount === null || chunkCount === 0)
  const hasConfig = Boolean(draft.embeddingEndpoint || draft.embeddingModel)

  const handleOpenPanel = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  const handleTestModel = useCallback(async () => {
    const hasModel = draft.embeddingModel.trim().length > 0

    if (hasModel) {
      setTestState({
        loading: true,
        success: false,
        message: t("settings.sections.shared.testing"),
      })

      try {
        const result = await testSettingsEmbeddingModel({
          enabled: true,
          endpoint: draft.embeddingEndpoint,
          apiKey: draft.embeddingApiKey,
          model: draft.embeddingModel,
          outputDimensionality: draft.embeddingOutputDimensionality,
          maxChunkChars: draft.embeddingMaxChunkChars,
          overlapChunkChars: draft.embeddingOverlapChunkChars,
        })
        setTestState({
          loading: false,
          success: true,
          message: t("settings.sections.embedding.testSuccessWithDimensions", {
            model: result.model,
            dimensions: result.dimensions,
          }),
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
      const modelList = await fetchEmbeddingModelList({
        enabled: true,
        endpoint: draft.embeddingEndpoint,
        apiKey: draft.embeddingApiKey,
        model: draft.embeddingModel,
        outputDimensionality: draft.embeddingOutputDimensionality,
        maxChunkChars: draft.embeddingMaxChunkChars,
        overlapChunkChars: draft.embeddingOverlapChunkChars,
      })
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
  }, [
    draft.embeddingApiKey,
    draft.embeddingEndpoint,
    draft.embeddingMaxChunkChars,
    draft.embeddingModel,
    draft.embeddingOutputDimensionality,
    draft.embeddingOverlapChunkChars,
    t,
  ])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.embedding.title")}</h2>
      </div>

      <div
        className={`rounded-lg border transition-colors ${
          draft.embeddingEnabled ? "border-primary/60 bg-primary/5" : "border-border"
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
              <span className="truncate text-sm font-medium">{t("settings.sections.embedding.enableLabel")}</span>
              {hasConfig && !draft.embeddingEnabled && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t("settings.sections.llm.configuredBadge")}
                </span>
              )}
              {draft.embeddingEnabled && (
                <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {t("settings.sections.llm.activeBadge")}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {t("settings.sections.embedding.enableHint")}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setDraft("embeddingEnabled", !draft.embeddingEnabled)
              if (!draft.embeddingEnabled) setExpanded(true)
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
              draft.embeddingEnabled
                ? "border-primary bg-primary"
                : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
            }`}
            title={draft.embeddingEnabled ? t("settings.sections.llm.toggleOff") : t("settings.sections.llm.toggleOn")}
            aria-label={draft.embeddingEnabled ? t("settings.sections.llm.deactivate") : t("settings.sections.llm.activate")}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                draft.embeddingEnabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {expanded && (
          <div className="space-y-4 border-t bg-background/50 px-4 py-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label>{t("settings.sections.embedding.endpoint")}</Label>
                <ResourceLink
                  href={SILICONFLOW_RESOURCE_URL}
                  title="为什么选择硅基流动：国内访问稳定，提供 BGE 等常用向量模型，适合资料库语义搜索。"
                >
                  硅基流动向量模型
                </ResourceLink>
              </div>
              <Input
                value={draft.embeddingEndpoint}
                onChange={(e) => setDraft("embeddingEndpoint", e.target.value)}
                placeholder="http://127.0.0.1:1234/v1/embeddings"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.embedding.endpointHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{t("settings.sections.embedding.apiKey")}</Label>
              <Input
                type="password"
                value={draft.embeddingApiKey}
                onChange={(e) => setDraft("embeddingApiKey", e.target.value)}
                placeholder={t("settings.sections.embedding.apiKeyPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleTestModel()}
                disabled={testState?.loading || modelListState?.loading}
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
              <Label>{t("settings.sections.embedding.model")}</Label>
              <ModelSelectInput
                value={draft.embeddingModel}
                options={modelOptions}
                onChange={(value) => setDraft("embeddingModel", value)}
                selectPlaceholder={t("settings.sections.shared.modelSelectPlaceholder")}
                inputPlaceholder={t("settings.sections.shared.modelManualPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("settings.sections.embedding.outputDimensionality")}</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={draft.embeddingOutputDimensionality ?? ""}
                onChange={(e) => {
                  setDraft("embeddingOutputDimensionality", parsePositiveInteger(e.target.value))
                }}
                placeholder="768"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.embedding.outputDimensionalityHint")}
              </p>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">
                {t("settings.sections.embedding.chunking")}
              </div>

              <div className="space-y-2">
                <Label>{t("settings.sections.embedding.maxChunkChars")}</Label>
                <Input
                  type="number"
                  min={200}
                  step={100}
                  value={draft.embeddingMaxChunkChars ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    setDraft(
                      "embeddingMaxChunkChars",
                      v === "" ? undefined : Number(v),
                    )
                  }}
                  placeholder="1000"
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.embedding.maxChunkCharsHint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("settings.sections.embedding.overlapChunkChars")}</Label>
                <Input
                  type="number"
                  min={0}
                  step={50}
                  value={draft.embeddingOverlapChunkChars ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    setDraft(
                      "embeddingOverlapChunkChars",
                      v === "" ? undefined : Number(v),
                    )
                  }}
                  placeholder="200"
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.embedding.overlapChunkCharsHint")}
                </p>
              </div>
            </div>

            {showLegacyMigration && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="text-sm font-medium text-destructive">
                  {t("settings.sections.embedding.legacyPromptTitle")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.embedding.legacyPromptBody", { count: legacyCount })}
                </p>
              </div>
            )}

            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">
                {t("settings.sections.embedding.statsHeading")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.embedding.chunkCount", { count: chunkCount ?? 0 })}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReindex}
                  disabled={reindex.kind === "running" || !project}
                >
                  {reindex.kind === "running"
                    ? t("settings.sections.embedding.reindexing", {
                        done: reindex.done,
                        total: reindex.total,
                      })
                    : t("settings.sections.embedding.reindexAll")}
                </Button>

                {legacyCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDropLegacy}
                    disabled={!project}
                  >
                    {t("settings.sections.embedding.dropLegacy")}
                  </Button>
                )}
              </div>

              {reindex.kind === "done" && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.embedding.reindexDone", { count: reindex.count })}
                </p>
              )}

              {legacyDropped && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.embedding.dropLegacyDone")}
                </p>
              )}

              {lastError && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">
                    {t("settings.sections.embedding.lastErrorHeading")}
                  </div>
                  <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-snug text-muted-foreground">
                    {lastError}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

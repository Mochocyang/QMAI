import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Info } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { saveNovelMode, saveNovelConfig } from "@/lib/project-store"
import { normalizePath } from "@/lib/path-utils"
import { exportProject } from "@/lib/novel/export"
import { testNovelModel, type TestableNovelModelTask } from "@/lib/novel/novel-model-test"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { NovelConfig } from "@/stores/wiki-store"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function NovelSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  const setNovelMode = useWikiStore((s) => s.setNovelMode)
  const setNovelConfigStore = useWikiStore((s) => s.setNovelConfig)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const project = useWikiStore((s) => s.project)
  const [exportStatus, setExportStatus] = useState<string>("")
  const [testStates, setTestStates] = useState<Record<TestableNovelModelTask, {
    loading: boolean
    message: string
    success: boolean
  } | undefined>>({
    writing: undefined,
    review: undefined,
    summary: undefined,
    extract: undefined,
  })

  const handleNovelModeToggle = async () => {
    const newMode = !novelMode
    setNovelMode(newMode)
    await saveNovelMode(newMode, project?.id, project?.path)
  }

  const updateNovelConfig = async (patch: Partial<NovelConfig>) => {
    const newConfig = { ...draft.novelConfig, ...patch }
    setDraft("novelConfig", newConfig)
    setNovelConfigStore(patch)
    await saveNovelConfig(newConfig, project?.id, project?.path)
  }

  const modelItems = useMemo(() => ([
    { task: "review", field: "reviewModel", wrapperClassName: "space-y-2" },
    { task: "summary", field: "summaryModel", wrapperClassName: "space-y-2" },
    {
      task: "extract",
      field: "extractModel",
      wrapperClassName: "space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3",
    },
  ] as const), [])

  const settingTooltip = (key: string) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label={t("novel.settings.help")}
          />
        }
      >
        <Info className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-sm leading-5">
        {t(`novel.settings.${key}`)}
      </TooltipContent>
    </Tooltip>
  )

  const runModelTest = async (task: TestableNovelModelTask) => {
    setTestStates((prev) => ({
      ...prev,
      [task]: {
        loading: true,
        message: t("novel.settings.testingModel"),
        success: false,
      },
    }))

    try {
      const result = await testNovelModel(llmConfig, draft.novelConfig, task)
      const suffix = result.usedFallbackModel
        ? t("novel.settings.testUsingDefaultMainModel", { model: result.model })
        : t("novel.settings.testUsingCurrentModel", { model: result.model })
      setTestStates((prev) => ({
        ...prev,
        [task]: {
          loading: false,
          message: `${t("novel.settings.testSuccess")} ${suffix}`,
          success: true,
        },
      }))
    } catch (error) {
      setTestStates((prev) => ({
        ...prev,
        [task]: {
          loading: false,
          message: t("novel.settings.testFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
          success: false,
        },
      }))
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.novel.title", { defaultValue: "小说模式" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.novel.description", {
            defaultValue:
              "项目级写作模式和小说工作流修改反馈窗口控制。",
          })}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("novel.mode.label")}</Label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleNovelModeToggle}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              novelMode ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                novelMode ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-sm">
            {novelMode ? t("novel.mode.enable") : t("novel.mode.disable")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("novel.mode.description")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("novel.settings.title")}</Label>
        <div className="grid gap-4 rounded-lg border p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.recentSummaryWindow")}</Label>
              {settingTooltip("recentSummaryWindowHint")}
            </div>
            <Input
              type="number"
              min={1}
              max={30}
              value={draft.novelConfig.recentSummaryWindow}
              onChange={(e) => updateNovelConfig({
                recentSummaryWindow: Math.max(1, Math.min(30, Number(e.target.value) || 1)),
              })}
              className="w-24"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.searchTopK")}</Label>
              {settingTooltip("searchTopKHint")}
            </div>
            <Input
              type="number"
              min={1}
              max={20}
              value={draft.novelConfig.searchTopK}
              onChange={(e) => updateNovelConfig({
                searchTopK: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
              })}
              className="w-24"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.contextTokenBudget")}</Label>
              {settingTooltip("contextTokenBudgetHelp")}
            </div>
            <Input
              type="number"
              min={0}
              max={200000}
              value={draft.novelConfig.contextTokenBudget}
              onChange={(e) => updateNovelConfig({
                contextTokenBudget: Math.max(0, Math.min(200000, Number(e.target.value) || 0)),
              })}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              {t("novel.settings.contextTokenBudgetHint")}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.chapterTargetChars")}</Label>
              {settingTooltip("chapterTargetCharsHint")}
            </div>
            <Input
              type="number"
              min={2000}
              max={6000}
              step={100}
              value={draft.novelConfig.chapterTargetChars}
              onChange={(e) => updateNovelConfig({
                chapterTargetChars: Math.max(2000, Math.min(6000, Number(e.target.value) || 3000)),
              })}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              {t("novel.settings.chapterTargetCharsHint")}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.autoIngestOnSave")}</Label>
              {settingTooltip("autoIngestOnSaveHint")}
            </div>
            <button
              type="button"
              onClick={() => updateNovelConfig({ autoIngestOnSave: !draft.novelConfig.autoIngestOnSave })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.novelConfig.autoIngestOnSave ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.novelConfig.autoIngestOnSave ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.reviewBeforeSave")}</Label>
              {settingTooltip("reviewBeforeSaveHint")}
            </div>
            <button
              type="button"
              onClick={() => updateNovelConfig({ reviewBeforeSave: !draft.novelConfig.reviewBeforeSave })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.novelConfig.reviewBeforeSave ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.novelConfig.reviewBeforeSave ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.deepPreviousChaptersAnalysis")}</Label>
              {settingTooltip("deepPreviousChaptersAnalysisHint")}
            </div>
            <button
              type="button"
              onClick={() => updateNovelConfig({ deepPreviousChaptersAnalysis: !draft.novelConfig.deepPreviousChaptersAnalysis })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.novelConfig.deepPreviousChaptersAnalysis ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.novelConfig.deepPreviousChaptersAnalysis ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.deepChapterReview")}</Label>
              {settingTooltip("deepChapterReviewHint")}
            </div>
            <button
              type="button"
              onClick={() => updateNovelConfig({ deepChapterReview: !draft.novelConfig.deepChapterReview })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.novelConfig.deepChapterReview ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.novelConfig.deepChapterReview ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.reviewReasoningEffort")}</Label>
              {settingTooltip("reviewReasoningEffortHint")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["low", "medium", "high"] as const).map((m) => {
                const active = (draft.novelConfig.reviewReasoningEffort ?? "high") === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateNovelConfig({ reviewReasoningEffort: m })}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {t(`settings.sections.llm.reasoning.${m}`)}
                  </button>
                )
              })}
            </div>
          </div>

          {modelItems.map((item) => {
            const state = testStates[item.task]
            return (
              <div key={item.task} className={item.wrapperClassName}>
                <div className="flex items-center gap-1.5">
                  <Label>{t(`novel.settings.${item.field}`)}</Label>
                  {settingTooltip(`${item.field}Hint`)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ChatModelSelector
                    value={draft.novelConfig[item.field] || aiChatModel || llmConfig.model || ""}
                    onChange={(model) => updateNovelConfig({
                      [item.field]: model === aiChatModel ? "" : model,
                    } as Partial<NovelConfig>)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={state?.loading}
                    onClick={() => runModelTest(item.task)}
                  >
                    {state?.loading ? t("novel.settings.testingModel") : t("novel.settings.testModel")}
                  </Button>
                </div>
                {item.task === "extract" ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("novel.settings.extractModelHint")}
                  </p>
                ) : null}
                {state?.message ? (
                  <p className={`text-xs ${state.success ? "text-emerald-600" : "text-destructive"}`}>
                    {state.message}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>
          {t("settings.sections.novel.feedbackWindow.title", {
            defaultValue: "修改反馈窗口",
          })}
        </Label>
        <div className="grid gap-4 rounded-lg border p-4">
          <div className="space-y-2">
            <Label>
              {t("settings.sections.novel.feedbackWindow.lookbackChapterCount", {
                defaultValue: "回溯章节数量",
              })}
            </Label>
            <input
              type="number"
              min={0}
              value={draft.revisionFeedbackWindowConfig.lookbackChapterCount}
              onChange={(event) => setDraft("revisionFeedbackWindowConfig", {
                ...draft.revisionFeedbackWindowConfig,
                lookbackChapterCount: Math.max(0, Number(event.target.value) || 0),
              })}
              className="w-24 rounded-md border bg-background px-3 py-1.5 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.sections.novel.feedbackWindow.lookbackChapterCountHint", {
                defaultValue:
                  "将多少章前序章节折叠回当前写作上下文。",
              })}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>
                {t("settings.sections.novel.feedbackWindow.currentChapterIncludeShouldImprove", {
                  defaultValue: "包含当前章节改进建议",
                })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.novel.feedbackWindow.currentChapterIncludeShouldImproveHint", {
                  defaultValue:
                    "关闭后，当前章节仅贡献必须修复项和延续指示。",
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft("revisionFeedbackWindowConfig", {
                ...draft.revisionFeedbackWindowConfig,
                currentChapterIncludeShouldImprove: !draft.revisionFeedbackWindowConfig.currentChapterIncludeShouldImprove,
              })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.revisionFeedbackWindowConfig.currentChapterIncludeShouldImprove ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.revisionFeedbackWindowConfig.currentChapterIncludeShouldImprove ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>
                {t("settings.sections.novel.feedbackWindow.previousChapterCarryEnabled", {
                  defaultValue: "读取上一章延续事项",
                })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.novel.feedbackWindow.previousChapterCarryEnabledHint", {
                  defaultValue:
                    "关闭后，上一章的延续事项不会注入当前上下文。",
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft("revisionFeedbackWindowConfig", {
                ...draft.revisionFeedbackWindowConfig,
                previousChapterCarryEnabled: !draft.revisionFeedbackWindowConfig.previousChapterCarryEnabled,
              })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.revisionFeedbackWindowConfig.previousChapterCarryEnabled ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.revisionFeedbackWindowConfig.previousChapterCarryEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>
                {t("settings.sections.novel.feedbackWindow.lookbackIncludeMustFixOnly", {
                  defaultValue: "回溯章节仅保留必须修复项",
                })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.novel.feedbackWindow.lookbackIncludeMustFixOnlyHint", {
                  defaultValue:
                    "关闭后，回溯章节也贡献改进建议。",
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft("revisionFeedbackWindowConfig", {
                ...draft.revisionFeedbackWindowConfig,
                lookbackIncludeMustFixOnly: !draft.revisionFeedbackWindowConfig.lookbackIncludeMustFixOnly,
              })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.revisionFeedbackWindowConfig.lookbackIncludeMustFixOnly ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.revisionFeedbackWindowConfig.lookbackIncludeMustFixOnly ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("novel.export.title")}</Label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!project) return
              setExportStatus(t("novel.export.exporting"))
              const pp = normalizePath(project.path)
              const exportPath = `${pp}/.novel/exports/${new Date().toISOString().slice(0, 10)}`
              const result = await exportProject({ projectPath: pp, exportPath })
              setExportStatus(result.success
                ? t("novel.export.success", { count: result.chapterCount })
                : t("novel.export.error", { message: result.message }))
            }}
            disabled={!project}
          >
            {t("novel.export.button")}
          </Button>
          {exportStatus ? (
            <span className="text-xs text-muted-foreground">{exportStatus}</span>
          ) : null}
        </div>
      </div>
      </div>
    </TooltipProvider>
  )
}

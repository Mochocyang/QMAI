import { useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Info } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { saveNovelConfig, saveDefaultLlmModel } from "@/lib/project-store"
import { getFirstAvailableModelKey, hasAvailableModels } from "@/lib/llm-model-keys"

import { testNovelModel, type TestableNovelModelTask } from "@/lib/novel/novel-model-test"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { NovelConfig } from "@/stores/wiki-store"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

const MODEL_PICKER_BLOCK_CLASS = "space-y-3 rounded-lg border border-border/60 p-4"

interface NovelModelPickerBlockProps {
  title: string
  hintKey?: string
  footnote?: string
  followChecked: boolean
  onFollowChange: (checked: boolean) => void
  modelValue: string
  onModelChange: (model: string) => void
  renderHint?: (hintKey: string) => ReactNode
  testState?: { loading: boolean; message: string; success: boolean }
  onTest?: () => void
  testLoadingLabel: string
  testLabel: string
  followLabel: string
}

function NovelModelPickerBlock({
  title,
  hintKey,
  footnote,
  followChecked,
  onFollowChange,
  modelValue,
  onModelChange,
  renderHint,
  testState,
  onTest,
  testLoadingLabel,
  testLabel,
  followLabel,
}: NovelModelPickerBlockProps) {
  return (
    <div className={MODEL_PICKER_BLOCK_CLASS}>
      <div className="flex items-center gap-1.5">
        <Label>{title}</Label>
        {hintKey && renderHint?.(hintKey)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex shrink-0 items-center gap-2">
          <input
            type="checkbox"
            checked={followChecked}
            onChange={(e) => onFollowChange(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm">{followLabel}</span>
        </label>
        <ChatModelSelector
          value={modelValue}
          onChange={onModelChange}
          disabled={followChecked}
        />
        {onTest ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={testState?.loading}
            onClick={onTest}
          >
            {testState?.loading ? testLoadingLabel : testLabel}
          </Button>
        ) : null}
      </div>
      {footnote ? (
        <p className="text-xs leading-5 text-muted-foreground/80">{footnote}</p>
      ) : null}
      {testState?.message ? (
        <p className={`text-xs ${testState.success ? "text-emerald-600" : "text-destructive"}`}>
          {testState.message}
        </p>
      ) : null}
    </div>
  )
}

export function NovelSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const setNovelConfigStore = useWikiStore((s) => s.setNovelConfig)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const project = useWikiStore((s) => s.project)
  const defaultLlmModel = draft.novelConfig.defaultLlmModel
  const isWorkflowModelFollowingChat = !defaultLlmModel.trim()
  const displayWorkflowDefaultModel = isWorkflowModelFollowingChat ? "" : defaultLlmModel

  const modelsAvailable = useMemo(
    () => hasAvailableModels(providerConfigs),
    [providerConfigs],
  )

  const [testStates, setTestStates] = useState<Record<TestableNovelModelTask, {
    loading: boolean
    message: string
    success: boolean
  } | undefined>>({
    writing: undefined,
    workflow: undefined,
    review: undefined,
    summary: undefined,
    extract: undefined,
    deAi: undefined,
  })

  const updateNovelConfig = async (patch: Partial<NovelConfig>) => {
    const newConfig = { ...draft.novelConfig, ...patch }
    setDraft("novelConfig", newConfig)
    setNovelConfigStore(patch)
    await saveNovelConfig(newConfig, project?.id, project?.path)
  }

  const updateWorkflowDefaultModel = async (model: string) => {
    await updateNovelConfig({ defaultLlmModel: model })
    await saveDefaultLlmModel(model)
  }

  const modelItems = useMemo(() => ([
    { task: "review", field: "reviewModel" },
    { task: "summary", field: "summaryModel" },
    { task: "extract", field: "extractModel" },
    { task: "deAi", field: "deAiModel" },
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
          {t("settings.sections.novel.title", { defaultValue: "小说设置" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.novel.description", {
            defaultValue:
              "项目级写作模式和小说工作流修改反馈窗口控制。",
          })}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("novel.settings.title")}</Label>
        <div className="grid gap-4 rounded-lg border p-4">
          {modelsAvailable && (
            <NovelModelPickerBlock
              title={t("novel.settings.defaultLlmModel")}
              hintKey="defaultLlmModelHint"
              footnote={t("novel.settings.defaultLlmModelScopeNote")}
              followChecked={isWorkflowModelFollowingChat}
              onFollowChange={(checked) => {
                if (checked) {
                  void updateWorkflowDefaultModel("")
                } else {
                  void updateWorkflowDefaultModel(
                    aiChatModel.trim() || getFirstAvailableModelKey(providerConfigs),
                  )
                }
              }}
              modelValue={displayWorkflowDefaultModel}
              onModelChange={(model) => void updateWorkflowDefaultModel(model)}
              renderHint={settingTooltip}
              testState={testStates.workflow}
              onTest={() => runModelTest("workflow")}
              followLabel={t("novel.settings.followChatModel")}
              testLoadingLabel={t("novel.settings.testingModel")}
              testLabel={t("novel.settings.testModel")}
            />
          )}

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
              <Label>{t("novel.settings.chatHistoryLength")}</Label>
              {settingTooltip("chatHistoryLengthHint")}
            </div>
            <div className="flex flex-wrap gap-2">
              {[2, 4, 6, 8, 10, 20].map((n) => {
                const active = draft.maxHistoryMessages === n
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDraft("maxHistoryMessages", n)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("novel.settings.chatHistoryLengthCurrent", {
                count: draft.maxHistoryMessages,
                turns: draft.maxHistoryMessages / 2,
              })}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.chapterTargetChars")}</Label>
              {settingTooltip("chapterTargetCharsHint")}
            </div>
            <Input
              type="number"
              min={500}
              max={20000}
              step={100}
              value={draft.novelConfig.chapterTargetChars}
              onChange={(e) => updateNovelConfig({
                chapterTargetChars: Math.max(500, Math.min(20000, Number(e.target.value) || 3000)),
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

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.communitySummaryEnabled")}</Label>
              {settingTooltip("communitySummaryEnabledHint")}
            </div>
            <button
              type="button"
              onClick={() => updateNovelConfig({ communitySummaryEnabled: !draft.novelConfig.communitySummaryEnabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.novelConfig.communitySummaryEnabled ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.novelConfig.communitySummaryEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {draft.novelConfig.communitySummaryEnabled && (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label>{t("novel.settings.communitySummaryInterval")}</Label>
                  {settingTooltip("communitySummaryIntervalHint")}
                </div>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={draft.novelConfig.communitySummaryInterval}
                  onChange={(e) => updateNovelConfig({
                    communitySummaryInterval: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                  })}
                  className="w-24"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <Label>{t("novel.settings.communitySummaryAsync")}</Label>
                  {settingTooltip("communitySummaryAsyncHint")}
                </div>
                <button
                  type="button"
                  onClick={() => updateNovelConfig({ communitySummaryAsync: !draft.novelConfig.communitySummaryAsync })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    draft.novelConfig.communitySummaryAsync ? "bg-primary" : "bg-input"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                      draft.novelConfig.communitySummaryAsync ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </>
          )}

          <div className="space-y-1 border-t border-border/60 pt-4">
            <Label>{t("novel.settings.taskModelsTitle")}</Label>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("novel.settings.taskModelsHint")}
            </p>
          </div>

          {modelItems.map((item) => {
            const state = testStates[item.task]
            const modelValue = draft.novelConfig[item.field] || ""
            const isFollowingChat = !modelValue
            const displayValue = isFollowingChat ? "" : modelValue

            return (
              <NovelModelPickerBlock
                key={item.task}
                title={t(`novel.settings.${item.field}`)}
                hintKey={`${item.field}Hint`}
                followChecked={isFollowingChat}
                onFollowChange={(checked) => {
                  if (checked) {
                    updateNovelConfig({
                      [item.field]: "",
                    } as Partial<NovelConfig>)
                  } else {
                    updateNovelConfig({
                      [item.field]: aiChatModel || " ",
                    } as Partial<NovelConfig>)
                  }
                }}
                modelValue={displayValue}
                onModelChange={(model) => updateNovelConfig({
                  [item.field]: model,
                } as Partial<NovelConfig>)}
                renderHint={settingTooltip}
                testState={state}
                onTest={() => runModelTest(item.task)}
                followLabel={t("novel.settings.followDefaultModel")}
                testLoadingLabel={t("novel.settings.testingModel")}
                testLabel={t("novel.settings.testModel")}
              />
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
            <div className="flex items-center gap-1.5">
              <Label>
                {t("settings.sections.novel.feedbackWindow.lookbackChapterCount", {
                  defaultValue: "回溯章节数量",
                })}
              </Label>
              {settingTooltip("feedbackWindowLookbackChapterCountHelp")}
            </div>
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
              <div className="flex items-center gap-1.5">
                <Label>
                  {t("settings.sections.novel.feedbackWindow.currentChapterIncludeShouldImprove", {
                    defaultValue: "包含当前章节改进建议",
                  })}
                </Label>
                {settingTooltip("feedbackWindowCurrentChapterIncludeShouldImproveHelp")}
              </div>
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
              <div className="flex items-center gap-1.5">
                <Label>
                  {t("settings.sections.novel.feedbackWindow.previousChapterCarryEnabled", {
                    defaultValue: "读取上一章延续事项",
                  })}
                </Label>
                {settingTooltip("feedbackWindowPreviousChapterCarryEnabledHelp")}
              </div>
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
              <div className="flex items-center gap-1.5">
                <Label>
                  {t("settings.sections.novel.feedbackWindow.lookbackIncludeMustFixOnly", {
                    defaultValue: "回溯章节仅保留必须修复项",
                  })}
                </Label>
                {settingTooltip("feedbackWindowLookbackIncludeMustFixOnlyHelp")}
              </div>
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
      </div>
    </TooltipProvider>
  )
}

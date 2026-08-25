import { useTranslation } from "react-i18next"
import { Info } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { saveNovelConfig, saveRevisionFeedbackWindowConfig, saveMaxHistoryMessages } from "@/lib/project-store"
import { notifyDeAiChapterConcurrencyChanged } from "@/lib/novel/de-ai-batch/chapter-concurrency"
import { CHAPTER_TARGET_CHARS_MAX, CHAPTER_TARGET_CHARS_MIN } from "@/lib/novel/deep-chapter-prompts"
import { useChatStore } from "@/stores/chat-store"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { NovelConfig, RevisionFeedbackWindowConfig } from "@/stores/wiki-store"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function NovelSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const setNovelConfigStore = useWikiStore((s) => s.setNovelConfig)
  const setRevisionFeedbackWindowConfig = useWikiStore((s) => s.setRevisionFeedbackWindowConfig)
  const setMaxHistoryMessages = useChatStore((s) => s.setMaxHistoryMessages)
  const project = useWikiStore((s) => s.project)

  const updateNovelConfig = async (patch: Partial<NovelConfig>) => {
    const newConfig = { ...draft.novelConfig, ...patch }
    setDraft("novelConfig", newConfig)
    setNovelConfigStore(patch)
    await saveNovelConfig(newConfig, project?.id, project?.path)
    if (patch.deAiBatchConcurrency !== undefined) {
      notifyDeAiChapterConcurrencyChanged()
    }
  }

  const updateFeedbackWindow = async (patch: Partial<RevisionFeedbackWindowConfig>) => {
    const next = { ...draft.revisionFeedbackWindowConfig, ...patch }
    setDraft("revisionFeedbackWindowConfig", next)
    setRevisionFeedbackWindowConfig(next)
    await saveRevisionFeedbackWindowConfig(next, project?.id, project?.path)
  }

  const updateMaxHistoryMessages = async (count: number) => {
    setDraft("maxHistoryMessages", count)
    setMaxHistoryMessages(count)
    await saveMaxHistoryMessages(count, project?.id, project?.path)
  }

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

  return (
    <TooltipProvider>
      <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.novel.title", { defaultValue: "写作设置" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.novel.description", {
            defaultValue:
              "项目级写作模式和修改反馈窗口设置。",
          })}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("novel.settings.title")}</Label>
        <div className="grid gap-4 rounded-lg border border-border/60 p-4">
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

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="de-ai-batch-concurrency-setting">{t("novel.settings.deAiBatchConcurrency")}</Label>
              {settingTooltip("deAiBatchConcurrencyHint")}
            </div>
            <Input
              id="de-ai-batch-concurrency-setting"
              aria-label={t("novel.settings.deAiBatchConcurrency")}
              type="number"
              min={1}
              max={5}
              value={draft.novelConfig.deAiBatchConcurrency}
              onChange={(e) => updateNovelConfig({
                deAiBatchConcurrency: Math.max(1, Math.min(5, Math.floor(Number(e.target.value) || 3))),
              })}
              className="w-24"
            />
            <p className="text-xs text-muted-foreground">{t("novel.settings.deAiBatchConcurrencyHint")}</p>
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
                    onClick={() => void updateMaxHistoryMessages(n)}
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
              min={CHAPTER_TARGET_CHARS_MIN}
              max={CHAPTER_TARGET_CHARS_MAX}
              step={100}
              value={draft.novelConfig.chapterTargetChars}
              onChange={(e) => updateNovelConfig({
                chapterTargetChars: Math.max(
                  CHAPTER_TARGET_CHARS_MIN,
                  Math.min(CHAPTER_TARGET_CHARS_MAX, Number(e.target.value) || 3000),
                ),
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
              onChange={(event) => void updateFeedbackWindow({
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
              onClick={() => void updateFeedbackWindow({
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
              onClick={() => void updateFeedbackWindow({
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
              onClick={() => void updateFeedbackWindow({
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

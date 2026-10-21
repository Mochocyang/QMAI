import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Info, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { saveNovelConfig, saveRevisionFeedbackWindowConfig, saveMaxHistoryMessages } from "@/lib/project-store"
import { notifyDeAiChapterConcurrencyChanged } from "@/lib/novel/de-ai-batch/chapter-concurrency"
import { CHAPTER_TARGET_CHARS_MAX, CHAPTER_TARGET_CHARS_MIN } from "@/lib/novel/deep-chapter-prompts"
import { useChatStore } from "@/stores/chat-store"
import { useGuideStore } from "@/lib/guide/guide-store"
import { GUIDE_RESTART_EVENT } from "@/lib/guide/guide-events"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { NovelConfig, RevisionFeedbackWindowConfig } from "@/stores/wiki-store"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

/**
 * 可折叠分组。
 *
 * 这一页原来把所有开关和数字堆在同一个大卡片里（14 个控件、无分组），
 * 用户反馈「比较乱」。现在按功能分组成 `<details>`：
 *   · 默认全部展开 —— 设置项不能藏起来让人找；
 *   · 收起后只剩一行标题，长页面也能一眼扫完；
 *   · 用原生 `<details>` 而不是自建折叠，键盘/读屏/焦点都免费拿到。
 */
function SettingGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <details open data-novel-group={id} className="group rounded-lg border border-border/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{title}</span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="grid gap-4 border-t border-border/60 px-4 py-4">{children}</div>
    </details>
  )
}

export function NovelSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const setNovelConfigStore = useWikiStore((s) => s.setNovelConfig)
  const setRevisionFeedbackWindowConfig = useWikiStore((s) => s.setRevisionFeedbackWindowConfig)
  const setMaxHistoryMessages = useChatStore((s) => s.setMaxHistoryMessages)
  const project = useWikiStore((s) => s.project)

  /*
   * 新手引导：只有一颗「播放」。
   *
   * 之前这里是「开关 + 播放」—— 开关负责“下次启动自动播”。用户明确说不需要
   * 开关（“只需要有一个播放按钮就可以了”），所以整块简化成：想再看就点播放。
   * 状态仍由 guide-store 写（`start()` 落成 running，localStorage 持久化），
   * 与引导卡片上的跳过/取消是同一份真相。
   */
  const startGuide = useGuideStore((s) => s.start)
  const playGuide = () => {
    startGuide()
    // 引导第一步是「在书架点设置」，所以要请外壳先把设置关掉、回到书架。
    window.dispatchEvent(new CustomEvent(GUIDE_RESTART_EVENT))
  }

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
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">
            {t("settings.sections.novel.title", { defaultValue: "写作设置" })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.sections.novel.description", {
              defaultValue: "项目级写作模式和修改反馈窗口设置。",
            })}
          </p>
        </div>

        {/* ── 写作上下文：带多少前文、检索几条、聊天记几轮 ── */}
        <SettingGroup id="context" title={t("settings.sections.novel.groups.context", { defaultValue: "写作上下文" })}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.recentSummaryWindow")}</Label>
              {settingTooltip("recentSummaryWindowHint")}
            </div>
            <Input
              aria-label={t("novel.settings.recentSummaryWindow")}
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
              aria-label={t("novel.settings.searchTopK")}
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
        </SettingGroup>

        {/* ── 章节生成：一章写多长、写作时查不查网、评审多用力 ── */}
        <SettingGroup id="generation" title={t("settings.sections.novel.groups.generation", { defaultValue: "章节生成" })}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <Label>{t("novel.settings.chapterTargetChars")}</Label>
                {settingTooltip("chapterTargetCharsHint")}
              </div>
              <Input
                aria-label={t("novel.settings.chapterTargetChars")}
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
            </div>
            <p className="text-xs text-muted-foreground">
              {t("novel.settings.chapterTargetCharsHint")}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.writingWebSearchEnabled")}</Label>
              {settingTooltip("writingWebSearchEnabledHint")}
            </div>
            <button
              type="button"
              aria-label={t("novel.settings.writingWebSearchEnabled")}
              aria-pressed={draft.novelConfig.writingWebSearchEnabled}
              onClick={() => updateNovelConfig({ writingWebSearchEnabled: !draft.novelConfig.writingWebSearchEnabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.novelConfig.writingWebSearchEnabled ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.novelConfig.writingWebSearchEnabled ? "translate-x-5" : "translate-x-0"
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
              aria-label={t("novel.settings.deepPreviousChaptersAnalysis")}
              aria-pressed={draft.novelConfig.deepPreviousChaptersAnalysis}
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
        </SettingGroup>

        {/* ── 界面提示：这两个只影响写作界面上的小提示，不参与生成 ── */}
        <SettingGroup id="hints" title={t("settings.sections.novel.groups.hints", { defaultValue: "界面提示" })}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.draftMemoryHintEnabled")}</Label>
              {settingTooltip("draftMemoryHintEnabledHint")}
            </div>
            <button
              type="button"
              aria-label={t("novel.settings.draftMemoryHintEnabled")}
              aria-pressed={draft.novelConfig.draftMemoryHintEnabled}
              onClick={() => updateNovelConfig({ draftMemoryHintEnabled: !draft.novelConfig.draftMemoryHintEnabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.novelConfig.draftMemoryHintEnabled ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.novelConfig.draftMemoryHintEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.inspirationHintEnabled")}</Label>
              {settingTooltip("inspirationHintEnabledHint")}
            </div>
            <button
              type="button"
              aria-label={t("novel.settings.inspirationHintEnabled")}
              aria-pressed={draft.novelConfig.inspirationHintEnabled}
              onClick={() => updateNovelConfig({ inspirationHintEnabled: !draft.novelConfig.inspirationHintEnabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                draft.novelConfig.inspirationHintEnabled ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  draft.novelConfig.inspirationHintEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </SettingGroup>

        {/* ── 社区摘要：章节写多了自动归纳 ── */}
        <SettingGroup id="community" title={t("settings.sections.novel.groups.community", { defaultValue: "社区摘要" })}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("novel.settings.communitySummaryEnabled")}</Label>
              {settingTooltip("communitySummaryEnabledHint")}
            </div>
            <button
              type="button"
              aria-label={t("novel.settings.communitySummaryEnabled")}
              aria-pressed={draft.novelConfig.communitySummaryEnabled}
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
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <Label>{t("novel.settings.communitySummaryInterval")}</Label>
                  {settingTooltip("communitySummaryIntervalHint")}
                </div>
                <Input
                  aria-label={t("novel.settings.communitySummaryInterval")}
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
                  aria-label={t("novel.settings.communitySummaryAsync")}
                  aria-pressed={draft.novelConfig.communitySummaryAsync}
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
        </SettingGroup>

        {/* ── 性能与并发：出问题时才需要动 ── */}
        <SettingGroup id="performance" title={t("settings.sections.novel.groups.performance", { defaultValue: "性能与并发" })}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
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
            </div>
            <p className="text-xs text-muted-foreground">{t("novel.settings.deAiBatchConcurrencyHint")}</p>
          </div>
        </SettingGroup>

        {/* ── 修改反馈窗口：写下一章时往回带多少"上次怎么改的" ── */}
        <SettingGroup id="feedback" title={t("settings.sections.novel.feedbackWindow.title", { defaultValue: "修改反馈窗口" })}>
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
              aria-label={t("settings.sections.novel.feedbackWindow.lookbackChapterCount", {
                defaultValue: "回溯章节数量",
              })}
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
              aria-label={t("settings.sections.novel.feedbackWindow.currentChapterIncludeShouldImprove", {
                defaultValue: "包含当前章节改进建议",
              })}
              aria-pressed={draft.revisionFeedbackWindowConfig.currentChapterIncludeShouldImprove}
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
              aria-label={t("settings.sections.novel.feedbackWindow.previousChapterCarryEnabled", {
                defaultValue: "读取上一章延续事项",
              })}
              aria-pressed={draft.revisionFeedbackWindowConfig.previousChapterCarryEnabled}
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
              aria-label={t("settings.sections.novel.feedbackWindow.lookbackIncludeMustFixOnly", {
                defaultValue: "回溯章节仅保留必须修复项",
              })}
              aria-pressed={draft.revisionFeedbackWindowConfig.lookbackIncludeMustFixOnly}
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
        </SettingGroup>

        {/* ── 新手引导：只有一颗「播放」 ── */}
        <div data-novel-guide="true" className="rounded-lg border border-border/60 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("settings.sections.novel.guide.title", { defaultValue: "新手引导" })}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("settings.sections.novel.guide.hint", {
                  defaultValue: "点「播放」从头看一遍引导，会一步步告诉你每一项在哪里、怎么设置。",
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              aria-label={t("settings.sections.novel.guide.play", { defaultValue: "播放新手引导" })}
              onClick={playGuide}
            >
              <Play className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {t("settings.sections.novel.guide.playLabel", { defaultValue: "播放" })}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

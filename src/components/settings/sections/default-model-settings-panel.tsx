import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { getFirstAvailableModelKey } from "@/lib/llm-model-keys"
import { testNovelModel, type TestableNovelModelTask } from "@/lib/novel/novel-model-test"
import { ChatModelSelector } from "@/components/chat/chat-model-selector"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { saveDefaultLlmModel, saveNovelConfig } from "@/lib/project-store"
import { notifyDeAiChapterConcurrencyChanged } from "@/lib/novel/de-ai-batch/chapter-concurrency"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { NovelConfig } from "@/stores/wiki-store"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

interface NovelModelPickerBlockProps {
  title: string
  footnote?: string
  followChecked: boolean
  onFollowChange: (checked: boolean) => void
  modelValue: string
  onModelChange: (model: string) => void
  testState?: { loading: boolean; message: string; success: boolean }
  onTest?: () => void
  followLabel: string
  testLoadingLabel: string
  testLabel: string
}

function NovelModelPickerBlock({
  title,
  footnote,
  followChecked,
  onFollowChange,
  modelValue,
  onModelChange,
  testState,
  onTest,
  followLabel,
  testLoadingLabel,
  testLabel,
}: NovelModelPickerBlockProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4">
      <div className="flex items-center gap-1.5">
        <Label>{title}</Label>
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
          <Button type="button" size="sm" variant="outline" disabled={testState?.loading} onClick={onTest}>
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

/**
 * 默认模型设置面板：默认模型（通用）+ 审稿 / 摘要 / 提取 / 去 AI 味 四个分环节模型。
 * 原本位于「写作设置」，现归并到「模型设置」聚合页的「默认模型」标签页下。
 */
export function DefaultModelSettingsPanel({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const setNovelConfigStore = useWikiStore((s) => s.setNovelConfig)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const project = useWikiStore((s) => s.project)

  const defaultLlmModel = draft.novelConfig.defaultLlmModel
  const isFollowingChat = !defaultLlmModel.trim()
  const displayDefault = isFollowingChat ? "" : defaultLlmModel

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
    if (patch.deAiBatchConcurrency !== undefined) {
      notifyDeAiChapterConcurrencyChanged()
    }
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

  const runModelTest = async (task: TestableNovelModelTask) => {
    setTestStates((prev) => ({
      ...prev,
      [task]: { loading: true, message: t("novel.settings.testingModel"), success: false },
    }))
    try {
      const result = await testNovelModel(llmConfig, draft.novelConfig, task)
      const suffix = result.usedFallbackModel
        ? t("novel.settings.testUsingDefaultMainModel", { model: result.model })
        : t("novel.settings.testUsingCurrentModel", { model: result.model })
      setTestStates((prev) => ({
        ...prev,
        [task]: { loading: false, message: `${t("novel.settings.testSuccess")} ${suffix}`, success: true },
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
    <div className="space-y-4">
      <NovelModelPickerBlock
        title={t("novel.settings.defaultLlmModel")}
        footnote={t("novel.settings.defaultLlmModelScopeNote")}
        followChecked={isFollowingChat}
        onFollowChange={(checked) => {
          if (checked) {
            void updateWorkflowDefaultModel("")
          } else {
            void updateWorkflowDefaultModel(
              aiChatModel.trim() || getFirstAvailableModelKey(providerConfigs),
            )
          }
        }}
        modelValue={displayDefault}
        onModelChange={(model) => void updateWorkflowDefaultModel(model)}
        testState={testStates.workflow}
        onTest={() => runModelTest("workflow")}
        followLabel={t("novel.settings.followChatModel")}
        testLoadingLabel={t("novel.settings.testingModel")}
        testLabel={t("novel.settings.testModel")}
      />

      {modelItems.map((item) => {
        const state = testStates[item.task]
        const modelValue = draft.novelConfig[item.field] || ""
        const isFollowing = !modelValue
        const displayValue = isFollowing ? "" : modelValue
        return (
          <NovelModelPickerBlock
            key={item.task}
            title={t(`novel.settings.${item.field}`)}
            followChecked={isFollowing}
            onFollowChange={(checked) => {
              if (checked) {
                void updateNovelConfig({ [item.field]: "" } as Partial<NovelConfig>)
              } else {
                void updateNovelConfig({ [item.field]: aiChatModel || " " } as Partial<NovelConfig>)
              }
            }}
            modelValue={displayValue}
            onModelChange={(model) => void updateNovelConfig({ [item.field]: model } as Partial<NovelConfig>)}
            testState={state}
            onTest={() => runModelTest(item.task)}
            followLabel={t("novel.settings.followDefaultModel")}
            testLoadingLabel={t("novel.settings.testingModel")}
            testLabel={t("novel.settings.testModel")}
          />
        )
      })}
    </div>
  )
}
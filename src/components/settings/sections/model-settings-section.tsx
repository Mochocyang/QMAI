import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import { useWikiStore, type ModelSettingsTabId } from "@/stores/wiki-store"
import { LlmProviderSection } from "./llm-provider-section"
import { EmbeddingSection } from "./embedding-section"
import { RerankSection } from "./rerank-section"
import { DefaultModelSettingsPanel } from "./default-model-settings-panel"

type ModelTabId = ModelSettingsTabId

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

/**
 * 模型设置聚合页：左侧设置分类中的「模型设置」入口进入本页。
 * 页面上方 4 个按钮（默认模型 / 大语言模型 / 重排模型 / 向量模型）切换，
 * 默认选中「大语言模型」。
 */
export function ModelSettingsSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()

  const TABS: Array<{ id: ModelTabId; label: string }> = [
    { id: "default", label: t("settings.categories.defaultModel", { defaultValue: "默认模型" }) },
    { id: "llm", label: t("settings.categories.llm", { defaultValue: "大语言模型" }) },
    { id: "rerank", label: t("settings.categories.rerank", { defaultValue: "重排模型" }) },
    { id: "embedding", label: t("settings.categories.embedding", { defaultValue: "向量模型" }) },
  ]

  const requestedTab = useWikiStore((s) => s.activeModelSettingsTab)
  const setRequestedTab = useWikiStore((s) => s.setActiveModelSettingsTab)
  const [active, setActive] = useState<ModelTabId>(() => requestedTab ?? "llm")

  useEffect(() => {
    if (!requestedTab) return
    setActive(requestedTab)
    setRequestedTab(null)
  }, [requestedTab, setRequestedTab])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.categories.model", { defaultValue: "模型设置" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.modelSettingsDescription", {
            defaultValue: "配置写小说各环节使用的模型：默认模型、大语言模型、重排模型、向量检索模型。",
          })}
        </p>
      </div>

      <div role="tablist" aria-label="模型设置" className="flex flex-wrap gap-2 border-b pb-0">
        {TABS.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.id)}
              className={`rounded-t-md border-b-2 px-4 py-2 text-sm transition-colors ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 pt-2">
        {active === "llm" && <LlmProviderSection />}
        {active === "default" && <DefaultModelSettingsPanel draft={draft} setDraft={setDraft} />}
        {active === "rerank" && <RerankSection draft={draft} setDraft={setDraft} />}
        {active === "embedding" && <EmbeddingSection draft={draft} setDraft={setDraft} />}
      </div>
    </div>
  )
}
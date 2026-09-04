import { useEffect } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { saveAiChatModel } from "@/lib/project-store"
import { getFirstAvailableModelKey } from "@/lib/llm-model-keys"

/** 聊天模型未选且已有可用模型时，自动选中第一个并持久化。 */
export function ensureAiChatModelSelected(): string {
  const { aiChatModel, providerConfigs, setAiChatModel } = useWikiStore.getState()
  const current = aiChatModel.trim()
  if (current) return current

  const first = getFirstAvailableModelKey(providerConfigs)
  if (!first) return ""

  setAiChatModel(first)
  void saveAiChatModel(first)
  return first
}

export function useEnsureAiChatModel(): void {
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)

  useEffect(() => {
    ensureAiChatModelSelected()
  }, [aiChatModel, providerConfigs])
}

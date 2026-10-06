import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { saveActivePresetId, saveLlmConfig, saveProviderConfigs, saveNovelConfig, saveDefaultLlmModel } from "@/lib/project-store"
import { getStableAvailableModelKey } from "@/lib/llm-model-keys"
import { confirmModelAction } from "./model-confirm"
import { persistModelChange } from "./model-persistence"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"

let writes: Promise<unknown> = Promise.resolve()
export async function deleteUiTestProvider(id: string, expected: ProviderOverride | undefined, label: string, dirty: boolean): Promise<boolean> {
  if (!(await confirmModelAction(`确定删除“${label || "这项模型配置"}”？${dirty ? "本项未保存的修改也会放弃。" : ""}引用此模型的默认选择将回退；不会删除小说或内置提供方目录。`))) return false
  if (expected) await saveUiTestProvider(id, null, expected)
  return true
}
/** 按提供方串行合并，只在持久化确认后更新运行配置。不同卡片同时保存也不覆盖彼此。 */
export function saveUiTestProvider(id: string, value: ProviderOverride | null, expected: ProviderOverride | undefined): Promise<void> {
  const action = writes.catch(() => undefined).then(async () => {
    const state = useWikiStore.getState()
    if (JSON.stringify(state.providerConfigs[id]) !== JSON.stringify(expected)) throw new Error("此提供方配置已在其他位置修改，请重新载入后再保存。当前输入仍然保留。")
    const next = { ...state.providerConfigs }
    if (value === null) delete next[id]
    else next[id] = value
    const preset = findLlmPresetById(id) ?? findLlmPresetById("custom")
    const active = state.activePresetId === id
    const resolved = value && preset && active ? resolveConfig(preset, value, state.llmConfig) : null
    const removedReference = (key: string) => value === null && (key.trim().startsWith(`${id}/`) || (getStableAvailableModelKey(key, state.providerConfigs).startsWith(`${id}/`) && !getStableAvailableModelKey(key, next)))
    const defaultFields = ["defaultLlmModel", "reviewModel", "summaryModel", "extractModel", "deAiModel"] as const
    const cleared = Object.fromEntries(defaultFields.filter(field => removedReference(state.novelConfig[field])).map(field => [field, ""]))
    const clearNovel = Object.keys(cleared).length > 0
    const clearDefault = removedReference(state.defaultLlmModel)
    await persistModelChange(async () => {
      await saveProviderConfigs(next)
      if (resolved) await saveLlmConfig(resolved)
      if (active && value === null) await saveActivePresetId(null)
      if (clearNovel) await saveNovelConfig({ ...state.novelConfig, ...cleared }, state.project?.id, state.project?.path)
      if (clearDefault) await saveDefaultLlmModel("")
    }, async () => {
      await saveProviderConfigs(state.providerConfigs)
      if (resolved) await saveLlmConfig(state.llmConfig)
      if (active && value === null) await saveActivePresetId(id)
      if (clearNovel) await saveNovelConfig(state.novelConfig, state.project?.id, state.project?.path)
      if (clearDefault) await saveDefaultLlmModel(state.defaultLlmModel)
    })
    useWikiStore.getState().setProviderConfigs(next)
    if (active && value === null && useWikiStore.getState().activePresetId === id) useWikiStore.getState().setActivePresetId(null)
    if (resolved && useWikiStore.getState().activePresetId === id) useWikiStore.getState().setLlmConfig(resolved)
    if ((useWikiStore.getState().project?.id ?? null) === (state.project?.id ?? null)) {
      if (clearNovel) useWikiStore.getState().setNovelConfig(cleared)
      if (clearDefault) useWikiStore.getState().setDefaultLlmModel("")
    }
  })
  writes = action
  return action
}

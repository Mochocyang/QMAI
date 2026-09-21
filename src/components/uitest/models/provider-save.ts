import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { saveActivePresetId, saveLlmConfig, saveProviderConfigs } from "@/lib/project-store"
import { persistModelChange } from "./model-persistence"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { resolveConfig } from "@/components/settings/preset-resolver"

let writes: Promise<unknown> = Promise.resolve()
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
    await persistModelChange(async () => {
      await saveProviderConfigs(next)
      if (resolved) await saveLlmConfig(resolved)
      if (active && value === null) await saveActivePresetId(null)
    }, async () => {
      await saveProviderConfigs(state.providerConfigs)
      if (resolved) await saveLlmConfig(state.llmConfig)
      if (active && value === null) await saveActivePresetId(id)
    })
    useWikiStore.getState().setProviderConfigs(next)
    if (active && value === null && useWikiStore.getState().activePresetId === id) useWikiStore.getState().setActivePresetId(null)
    if (resolved && useWikiStore.getState().activePresetId === id) useWikiStore.getState().setLlmConfig(resolved)
  })
  writes = action
  return action
}

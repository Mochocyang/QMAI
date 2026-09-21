import { useWikiStore, type ModelSettingsTabId } from "@/stores/wiki-store"

export function openModelSettings(tab: ModelSettingsTabId = "llm"): void {
  const { setActiveSettingsCategory, setActiveModelSettingsTab, setActiveView } = useWikiStore.getState()
  setActiveSettingsCategory("model")
  setActiveModelSettingsTab(tab)
  setActiveView("settings")
}

export function openDefaultModelSettings(): void {
  openModelSettings("default")
}

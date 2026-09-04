import { beforeEach, describe, expect, it } from "vitest"
import { openDefaultModelSettings, openModelSettings } from "./open-settings"
import { useWikiStore } from "@/stores/wiki-store"

describe("openModelSettings", () => {
  beforeEach(() => {
    useWikiStore.setState({
      activeView: "sources",
      activeSettingsCategory: null,
      activeModelSettingsTab: null,
    })
  })

  it("opens model settings on the requested tab", () => {
    openModelSettings("default")
    const state = useWikiStore.getState()
    expect(state.activeView).toBe("settings")
    expect(state.activeSettingsCategory).toBe("model")
    expect(state.activeModelSettingsTab).toBe("default")
  })

  it("openDefaultModelSettings targets the default model tab", () => {
    openDefaultModelSettings()
    const state = useWikiStore.getState()
    expect(state.activeView).toBe("settings")
    expect(state.activeSettingsCategory).toBe("model")
    expect(state.activeModelSettingsTab).toBe("default")
  })
})

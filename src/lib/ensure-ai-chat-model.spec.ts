import { beforeEach, describe, expect, it, vi } from "vitest"

const saveAiChatModel = vi.fn(async () => {})

vi.mock("@/lib/project-store", () => ({
  saveAiChatModel: (...args: unknown[]) => saveAiChatModel(...args),
}))

import { ensureAiChatModelSelected } from "./ensure-ai-chat-model"
import { useWikiStore } from "@/stores/wiki-store"
import type { ProviderConfigs } from "@/stores/wiki-store"

function saved(id: string) {
  return { id, model: id, name: id, createdAt: 1 }
}

const availableConfigs: ProviderConfigs = {
  openai: { enabled: true, apiKey: "key", savedModels: [saved("gpt-4o"), saved("gpt-4.1")] },
  anthropic: { enabled: true, apiKey: "key", savedModels: [saved("claude-sonnet")] },
}

describe("ensureAiChatModelSelected", () => {
  beforeEach(() => {
    saveAiChatModel.mockClear()
    useWikiStore.setState({
      aiChatModel: "",
      providerConfigs: {},
    })
  })

  it("does nothing when no provider models are available", () => {
    expect(ensureAiChatModelSelected()).toBe("")
    expect(useWikiStore.getState().aiChatModel).toBe("")
    expect(saveAiChatModel).not.toHaveBeenCalled()
  })

  it("keeps an already selected chat model", () => {
    useWikiStore.setState({
      aiChatModel: "anthropic/claude-sonnet",
      providerConfigs: availableConfigs,
    })

    expect(ensureAiChatModelSelected()).toBe("anthropic/claude-sonnet")
    expect(useWikiStore.getState().aiChatModel).toBe("anthropic/claude-sonnet")
    expect(saveAiChatModel).not.toHaveBeenCalled()
  })

  it("selects the first available model when chat model is empty", () => {
    useWikiStore.setState({ providerConfigs: availableConfigs })

    expect(ensureAiChatModelSelected()).toBe("openai/gpt-4o")
    expect(useWikiStore.getState().aiChatModel).toBe("openai/gpt-4o")
    expect(saveAiChatModel).toHaveBeenCalledWith("openai/gpt-4o")
  })
})

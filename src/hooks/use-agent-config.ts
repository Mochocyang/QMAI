import { useCallback, useEffect, useMemo, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { loadDeAiSkillConfig, type DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import { resolveModelConfig } from "@/lib/novel/model-resolver"
import { ToolRegistry } from "@/lib/agent/registry"
import { buildAgentConfig, modelSupportsTools } from "@/lib/agent/config"
import type { AgentConfig } from "@/lib/agent/types"

export interface UseAgentConfigResult {
  config: AgentConfig | null
  registry: ToolRegistry
  supportsTools: boolean
  skillConfigLoaded: boolean
}

export function useAgentConfig(systemPrompt: string): UseAgentConfigResult {
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const projectPath = useWikiStore((s) => s.project?.path)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const baseLlmConfig = useWikiStore((s) => s.llmConfig)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)

  const chatConversations = useChatStore((s) => s.conversations)
  const chatMessages = useChatStore((s) => s.messages)

  const outlineConversations = useOutlineChatStore((s) => s.conversations)

  const [skillConfig, setSkillConfig] = useState<DeAiSkillConfig | null>(null)
  const [skillConfigLoaded, setSkillConfigLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSkillConfigLoaded(false)

    if (!projectPath) {
      setSkillConfig(null)
      setSkillConfigLoaded(true)
      return
    }

    loadDeAiSkillConfig(projectPath)
      .then((config) => {
        if (cancelled) return
        setSkillConfig(config)
        setSkillConfigLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setSkillConfig(null)
        setSkillConfigLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, dataVersion])

  const getSkillConfig = useCallback(() => skillConfig, [skillConfig])

  const getChatConversations = useCallback(
    () =>
      chatConversations.map((conv) => ({
        id: conv.id,
        title: conv.title,
        messages: chatMessages
          .filter((m) => m.conversationId === conv.id)
          .map((m) => ({ role: m.role, content: m.content })),
      })),
    [chatConversations, chatMessages],
  )

  const getOutlineConversations = useCallback(
    () =>
      outlineConversations.map((conv) => ({
        id: conv.id,
        title: conv.title,
        messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
      })),
    [outlineConversations],
  )

  return useMemo(() => {
    const supportsTools = modelSupportsTools(aiChatModel)

    if (!supportsTools || !projectPath || !skillConfigLoaded) {
      return {
        config: null,
        registry: new ToolRegistry(),
        supportsTools,
        skillConfigLoaded: false,
      }
    }

    const llmConfig = resolveModelConfig(aiChatModel, baseLlmConfig, providerConfigs)
    const registry = new ToolRegistry()
    const config = buildAgentConfig(aiChatModel, systemPrompt, registry, {
      wikiPath: projectPath,
      getSkillConfig,
      getChatConversations,
      getOutlineConversations,
      llmConfig,
    })

    return {
      config,
      registry,
      supportsTools: true,
      skillConfigLoaded: true,
    }
  }, [
    aiChatModel,
    projectPath,
    skillConfigLoaded,
    baseLlmConfig,
    providerConfigs,
    systemPrompt,
    getSkillConfig,
    getChatConversations,
    getOutlineConversations,
  ])
}

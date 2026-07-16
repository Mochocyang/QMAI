import { useCallback, useEffect, useMemo, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { loadDeAiSkillConfig, type DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import { loadAllLinkedSkillsContent, loadUserSkillConfig, resolveEnabledWritingSkills } from "@/lib/novel/user-skill-store"
import type { UserSkill } from "@/lib/novel/skill-library"
import { resolveDefaultModel, resolveModelConfig } from "@/lib/novel/model-resolver"
import { runDeepChapterGeneration } from "@/lib/novel/deep-chapter-generation"
import { normalizePath } from "@/lib/path-utils"
import { ToolRegistry } from "@/lib/agent/registry"
import { buildAgentConfig, modelSupportsTools } from "@/lib/agent/config"
import type { AgentConfig } from "@/lib/agent/types"
import type { AiCapability } from "@/lib/agent/capabilities/types"
import { buildMcpRuntime } from "@/lib/mcp/runtime"
import { RealMcpConnector } from "@/lib/mcp/real-connector"

export interface UseAgentConfigResult {
  config: AgentConfig | null
  registry: ToolRegistry
  supportsTools: boolean
  skillConfigLoaded: boolean
  skillConfig: DeAiSkillConfig | null
  writingSkills: UserSkill[]
  mcpCapabilities: AiCapability[]
  mcpWarnings: string[]
}

export function useAgentConfig(systemPrompt: string, getPlanBlueprint?: () => string | undefined): UseAgentConfigResult {
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const defaultLlmModel = useWikiStore((s) => s.defaultLlmModel)
  const novelDefaultLlmModel = useWikiStore((s) => s.novelConfig.defaultLlmModel)
  const projectPath = useWikiStore((s) => s.project?.path)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const baseLlmConfig = useWikiStore((s) => s.llmConfig)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const searchApiConfig = useWikiStore((s) => s.searchApiConfig)
  const mcpConfig = useWikiStore((s) => s.mcpConfig)
  const aiWorkflowMode = useWikiStore((s) => s.aiWorkflowMode)

  const chatConversations = useChatStore((s) => s.conversations)
  const chatMessages = useChatStore((s) => s.messages)

  const outlineConversations = useOutlineChatStore((s) => s.conversations)

  const [skillConfig, setSkillConfig] = useState<DeAiSkillConfig | null>(null)
  const [writingSkills, setWritingSkills] = useState<UserSkill[]>([])
  const [skillConfigLoaded, setSkillConfigLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSkillConfigLoaded(false)

    if (!projectPath) {
      setSkillConfig(null)
      setWritingSkills([])
      setSkillConfigLoaded(true)
      return
    }

    Promise.all([
      loadDeAiSkillConfig(projectPath).catch(() => null),
      loadUserSkillConfig(projectPath)
        .then((config) => loadAllLinkedSkillsContent(config))
        .then(resolveEnabledWritingSkills)
        .catch(() => [] as UserSkill[]),
    ])
      .then(([config, enabledWritingSkills]) => {
        if (cancelled) return
        setSkillConfig(config)
        setWritingSkills(enabledWritingSkills)
        setSkillConfigLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setSkillConfig(null)
        setWritingSkills([])
        setSkillConfigLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, dataVersion])

  const getSkillConfig = useCallback(() => skillConfig, [skillConfig])
  const getUserSkills = useCallback(() => writingSkills, [writingSkills])
  const getSearchApiConfig = useCallback(() => searchApiConfig, [searchApiConfig])

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
    const agentLlmConfig = resolveDefaultModel(baseLlmConfig)
    const supportsTools = modelSupportsTools(agentLlmConfig.model)

    if (!supportsTools || !projectPath || !skillConfigLoaded) {
      return {
        config: null,
        registry: new ToolRegistry(),
        supportsTools,
        skillConfigLoaded: false,
        skillConfig,
        writingSkills,
        mcpCapabilities: [],
        mcpWarnings: [],
      }
    }

    const chapterWritingLlmConfig = resolveModelConfig(aiChatModel, baseLlmConfig, providerConfigs)
    const registry = new ToolRegistry()
    const wikiPath = `${normalizePath(projectPath)}/wiki`
    const novelMode = useWikiStore.getState().novelMode
    const realMcpConnector = (mcpConfig?.servers ?? []).some((server) => server.enabled && server.command)
      ? new RealMcpConnector(mcpConfig)
      : undefined
    const mcpRuntime = buildMcpRuntime(mcpConfig, undefined, realMcpConnector)
    const config = buildAgentConfig(agentLlmConfig.model, systemPrompt, registry, {
      wikiPath,
      getSkillConfig,
      getUserSkills,
      getSearchApiConfig,
      getChatConversations,
      getOutlineConversations,
      mcpTools: mcpRuntime.mcpTools,
      llmConfig: agentLlmConfig,
      chapterWritingLlmConfig,
      aiWorkflowMode,
      runDeepChapterGeneration,
      draftMode: novelMode,
      projectPath: normalizePath(projectPath),
      getPlanBlueprint,
      disabledTools: ["write_chapter", "write_outline_node", "write_memory"],
    })

    return {
      config,
      registry,
      supportsTools: true,
      skillConfigLoaded: true,
      skillConfig,
      writingSkills,
      mcpCapabilities: mcpRuntime.mcpCapabilities,
      mcpWarnings: mcpRuntime.warnings,
    }
  }, [
    aiChatModel,
    defaultLlmModel,
    novelDefaultLlmModel,
    projectPath,
    skillConfigLoaded,
    baseLlmConfig,
    providerConfigs,
    mcpConfig,
    aiWorkflowMode,
    getSearchApiConfig,
    getUserSkills,
    systemPrompt,
    getSkillConfig,
    writingSkills,
    getChatConversations,
    getOutlineConversations,
  ])
}

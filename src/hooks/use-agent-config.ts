import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { loadDeAiSkillConfig, type DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"
import { loadAllLinkedSkillsContent, loadUserSkillConfig, resolveEnabledWritingSkills } from "@/lib/novel/user-skill-store"
import type { UserSkill } from "@/lib/novel/skill-library"
import { resolveAgentSessionModel, resolveModelConfig } from "@/lib/novel/model-resolver"
import { runDeepChapterGeneration } from "@/lib/novel/deep-chapter-generation"
import { normalizePath } from "@/lib/path-utils"
import { ToolRegistry } from "@/lib/agent/registry"
import { buildAgentConfig, isFunctionCallingEnabled, modelSupportsTools } from "@/lib/agent/config"
import type { AgentConfig } from "@/lib/agent/types"
import {
  getPluginToolDescriptors,
  invokePluginToolViaTauri,
  subscribePluginTools,
} from "@/lib/plugins/tool-sync"
export interface UseAgentConfigResult {
  config: AgentConfig | null
  registry: ToolRegistry
  supportsTools: boolean
  skillConfigLoaded: boolean
  skillConfig: DeAiSkillConfig | null
  writingSkills: UserSkill[]
}

export function useAgentConfig(
  systemPrompt: string,
  getPlanBlueprint?: () => string | undefined,
  getSelectedSkillsPrompt?: () => string | undefined,
  getWritingStyleIdOverride?: () => string | null | undefined,
): UseAgentConfigResult {
  const aiChatModel = useWikiStore((s) => s.aiChatModel)
  const defaultLlmModel = useWikiStore((s) => s.defaultLlmModel)
  const novelConfig = useWikiStore((s) => s.novelConfig)
  const projectPath = useWikiStore((s) => s.project?.path)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const baseLlmConfig = useWikiStore((s) => s.llmConfig)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const searchApiConfig = useWikiStore((s) => s.searchApiConfig)
  const aiWorkflowMode = useWikiStore((s) => s.aiWorkflowMode)

  const chatConversations = useChatStore((s) => s.conversations)
  const chatMessages = useChatStore((s) => s.messages)

  const outlineConversations = useOutlineChatStore((s) => s.conversations)

  const [skillConfig, setSkillConfig] = useState<DeAiSkillConfig | null>(null)
  const [writingSkills, setWritingSkills] = useState<UserSkill[]>([])
  const [skillConfigLoaded, setSkillConfigLoaded] = useState(false)

  /*
   * 插件工具是「异步拉取 → 同步读缓存」的模块级快照（`buildAgentConfig` 是同步函数，
   * 拿不到 await）。这里订阅一次，插件启用/停用后这个 memo 会重算：
   * 否则 config 会一直用旧快照，模型要等到下次无关的重渲染才知道有新工具。
   */
  const pluginTools = useSyncExternalStore(
    subscribePluginTools,
    getPluginToolDescriptors,
    getPluginToolDescriptors,
  )

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
    // 推理程度不再有会话级覆盖：档位由供应商配置（聊天框悬停弹窗写回的那一份）决定。
    const agentLlmConfig = resolveAgentSessionModel(baseLlmConfig, novelConfig, aiWorkflowMode)
    const modelOk = modelSupportsTools(agentLlmConfig.model, agentLlmConfig.provider)
    const fcEnabled = isFunctionCallingEnabled(agentLlmConfig)
    const supportsTools = modelOk && fcEnabled

    /*
     * ⚠️ 这里**不能**因为「模型不支持工具」就返回 config: null。
     *
     * 那样等于把「不支持工具」当成「不能用」：o1 / o3-mini / deepseek-reasoner
     * 以及用户关闭 Function Calling 的本地模型都会被整块拒绝，
     * 连普通对话都发不出去 —— 而设置页那个开关的说明恰恰承诺了
     * 「关闭后请求不携带 tools/tool_choice，用于兼容不支持工具调用的本地模型」。
     *
     * 正确形状：照常构建 config，`buildAgentConfig` 在无工具时注册 0 个工具，
     * `AgentRunner` 也不发 tools/tool_choice，于是这就是一次普通对话。
     * `supportsTools` 继续如实反映「本轮会不会带工具」，供提示语使用。
     */
    if (!projectPath || !skillConfigLoaded) {
      return {
        config: null,
        registry: new ToolRegistry(),
        supportsTools,
        skillConfigLoaded: false,
        skillConfig,
        writingSkills,
      }
    }

    // 正文写作同样直接取该模型的供应商配置（含推理档）。
    const chapterWritingLlmConfig = resolveModelConfig(aiChatModel, baseLlmConfig, providerConfigs)
    const registry = new ToolRegistry()
    const wikiPath = `${normalizePath(projectPath)}/wiki`
    const novelMode = useWikiStore.getState().novelMode
    const config = buildAgentConfig(agentLlmConfig.model, systemPrompt, registry, {
      wikiPath,
      getSkillConfig,
      getUserSkills,
      getSearchApiConfig,
      getChatConversations,
      getOutlineConversations,
      llmConfig: agentLlmConfig,
      maxContextSize: agentLlmConfig.maxContextSize,
      chapterWritingLlmConfig,
      aiWorkflowMode,
      runDeepChapterGeneration,
      draftMode: novelMode,
      projectPath: normalizePath(projectPath),
      getPlanBlueprint,
      getSelectedSkillsPrompt,
      getWritingStyleIdOverride,
      disabledTools: ["write_chapter", "write_outline_node", "write_memory"],
      // 运行中插件贡献的工具：不传这两个，模型永远不知道插件工具存在
      pluginTools,
      invokePluginTool: invokePluginToolViaTauri(),
    })

    return {
      config,
      registry,
      supportsTools,
      skillConfigLoaded: true,
      skillConfig,
      writingSkills,
    }
  }, [
    aiChatModel,
    defaultLlmModel,
    novelConfig,
    projectPath,
    skillConfigLoaded,
    baseLlmConfig,
    providerConfigs,
    aiWorkflowMode,
    getSearchApiConfig,
    getUserSkills,
    systemPrompt,
    getSkillConfig,
    writingSkills,
    getChatConversations,
    getOutlineConversations,
    getPlanBlueprint,
    getSelectedSkillsPrompt,
    getWritingStyleIdOverride,
    pluginTools,
  ])
}

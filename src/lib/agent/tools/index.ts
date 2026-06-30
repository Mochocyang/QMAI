import type { ToolRegistry } from "../registry"
import { createReadChapterTool } from "./read-chapter"
import { createReadOutlineTool } from "./read-outline"
import { createReadMemoryTool } from "./read-memory"
import { createReadDeductionTool } from "./read-deduction"
import { createReadChatHistoryTool } from "./read-chat-history"
import { createReadOutlineHistoryTool } from "./read-outline-history"
import { createSearchChaptersTool } from "./search-chapters"
import { createListChaptersTool } from "./list-chapters"
import { createListOutlinesTool } from "./list-outlines"
import { createListMemoriesTool } from "./list-memories"
import { createListDeductionsTool } from "./list-deductions"
import { createWriteChapterTool } from "./write-chapter"
import { createWriteOutlineNodeTool } from "./write-outline-node"
import { createWriteMemoryTool } from "./write-memory"
import { createApplySkillTool } from "./apply-skill"
import type { DeAiSkillConfig } from "@/lib/novel/de-ai-skill-library"

export interface ToolFactoryOptions {
  wikiPath: string
  getSkillConfig: () => DeAiSkillConfig | null
  getChatConversations: () => { id: string; title: string; messages: { role: string; content: string }[] }[]
  getOutlineConversations: () => { id: string; title: string; messages: { role: string; content: string }[] }[]
}

export function registerAllBuiltInTools(registry: ToolRegistry, options: ToolFactoryOptions): void {
  const chaptersDir = `${options.wikiPath}/chapters`
  const memoryDir = `${options.wikiPath}/memory`
  const outlinesDir = `${options.wikiPath}/outlines`
  const simDir = `${options.wikiPath}/../.qmai/simulations`

  registry.register(createReadChapterTool(chaptersDir))
  registry.register(createReadOutlineTool(outlinesDir))
  registry.register(createReadMemoryTool(memoryDir))
  registry.register(createReadDeductionTool(simDir))
  registry.register(createReadChatHistoryTool(options.getChatConversations()))
  registry.register(createReadOutlineHistoryTool(options.getOutlineConversations()))
  registry.register(createSearchChaptersTool(chaptersDir))
  registry.register(createListChaptersTool(chaptersDir))
  registry.register(createListOutlinesTool(outlinesDir))
  registry.register(createListMemoriesTool(memoryDir))
  registry.register(createListDeductionsTool(simDir))
  registry.register(createWriteChapterTool(chaptersDir))
  registry.register(createWriteOutlineNodeTool(outlinesDir))
  registry.register(createWriteMemoryTool(memoryDir))
  registry.register(createApplySkillTool(options.getSkillConfig))
}

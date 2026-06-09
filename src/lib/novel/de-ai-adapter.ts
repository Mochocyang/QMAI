import type { ChatMessage } from "@/lib/llm-providers"
import qmQuaiSkillMarkdown from "../../../QM-QUAI.md?raw"
import { CHINESE_NOVEL_DE_AI_RULES } from "./de-ai-rules"

const QM_QUAI_SYSTEM_PROMPT = [
  qmQuaiSkillMarkdown.trim(),
  "",
  CHINESE_NOVEL_DE_AI_RULES,
].join("\n")

export function buildQmQuaiSystemPrompt(): string {
  return QM_QUAI_SYSTEM_PROMPT
}

export function buildDeAiSystemPrompt(): string {
  return buildQmQuaiSystemPrompt()
}

export function buildQmQuaiRewriteMessages(content: string): ChatMessage[] {
  if (!content.trim()) throw new Error("去AI味内容为空，无法处理")
  return [
    { role: "system", content: buildQmQuaiSystemPrompt() },
    {
      role: "user",
      content: "请严格按照 QM-QUAI skill 规则处理下面正文。\n\n输出仅返回改写后的正文，不要解释。\n\n正文如下：\n\n" + content,
    },
  ]
}

export function buildDeAiRewriteMessages(content: string): ChatMessage[] {
  return buildQmQuaiRewriteMessages(content)
}

const DIRECTIVE_PREFIX = [
  "请保持剧情一致，并用更自然、更像真人网文作者的方式输出。",
  "减少套话、总结腔和机械解释。",
  "注意中文小说适配：保留角色声线、对白毛边、叙事节奏和必要停顿，不要按非虚构文章规则硬删副词或压缩到固定字数。",
  "",
  "任务内容：",
  "",
].join("\n")

export function injectDeAiDirective(content: string, enabled: boolean): string {
  if (!enabled) return content
  return DIRECTIVE_PREFIX + content
}

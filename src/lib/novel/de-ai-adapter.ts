import type { ChatMessage } from "@/lib/llm-providers"
import { readFile } from "@/commands/fs"
import { join } from "@tauri-apps/api/path"
import deAiSkillMarkdown from "../../../skills/de-ai-writing/SKILL.md?raw"

const QM_QUAI_SYSTEM_PROMPT = deAiSkillMarkdown.trim()

export async function loadCustomDeAiSkill(projectPath?: string | null): Promise<string | null> {
  if (!projectPath) return null
  try {
    const skillPath = await join(projectPath, "de-ai-skill.txt")
    const content = await readFile(skillPath)
    const trimmed = content.trim()
    return trimmed || null
  } catch {
    return null
  }
}

export function buildQmQuaiSystemPrompt(customSkill?: string): string {
  if (customSkill && customSkill.trim()) {
    return customSkill.trim()
  }
  return QM_QUAI_SYSTEM_PROMPT
}

export function buildDeAiSystemPrompt(customSkill?: string): string {
  return buildQmQuaiSystemPrompt(customSkill)
}

export function buildQmQuaiRewriteMessages(content: string, customSkill?: string): ChatMessage[] {
  if (!content.trim()) throw new Error("去AI味内容为空，无法处理")
  return [
    { role: "system", content: buildQmQuaiSystemPrompt(customSkill) },
    {
      role: "user",
      content: "请严格按照 QM-QUAI skill 规则处理下面正文。\n\n输出仅返回改写后的正文，不要解释。\n\n正文如下：\n\n" + content,
    },
  ]
}

export function buildDeAiRewriteMessages(content: string, customSkill?: string): ChatMessage[] {
  return buildQmQuaiRewriteMessages(content, customSkill)
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

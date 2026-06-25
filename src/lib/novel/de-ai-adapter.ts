import type { ChatMessage } from "@/lib/llm-providers"
import { readFile } from "@/commands/fs"
import { join, resourceDir } from "@tauri-apps/api/path"
import deAiSkillMarkdown from "../../../skills/de-ai-writing/SKILL.md?raw"
import type { ContextPack } from "./context-engine"

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

// ============ 智能场景选择功能 ============

/**
 * 场景类型
 */
type ContentGenre = 'web-novel' | 'popular-science' | 'commentary' | 'translation' | 'default'

/**
 * 检测内容场景类型
 * @param task 用户请求文本
 * @param contextPack 上下文包（可选）
 * @returns 场景类型
 */
function detectContentGenre(
  task: string,
  contextPack?: ContextPack
): ContentGenre {
  // 1. 翻译任务优先级最高
  if (/翻译|translate|译文|英译中|中译英/.test(task)) {
    return 'translation'
  }

  // 2. 科普文章
  if (/科普|科学普及|知识分享|科技解读/.test(task)) {
    return 'popular-science'
  }

  // 3. 观点评论（触发good-writing）
  if (/评论|书评|影评|观点|散文|随笔/.test(task)) {
    return 'commentary'
  }

  // 4. 检查大纲中的genre标记
  if (contextPack?.outline) {
    const genreMatch = contextPack.outline.match(/genre:\s*(\w+)/i)
    if (genreMatch) {
      const genre = genreMatch[1].toLowerCase()
      if (['xuanhuan', 'wuxia', 'xianxia', 'dushi'].includes(genre)) {
        return 'web-novel'
      }
    }
  }

  // 5. 默认：网络小说（项目主要使用场景）
  return 'web-novel'
}

/**
 * 场景类型映射到skill文件路径
 * @param genre 场景类型
 * @returns skill文件路径
 */
function genreToSkillPath(genre: ContentGenre): string {
  switch (genre) {
    case 'commentary':
    case 'popular-science':
      return 'skills/good-writing/SKILL.md'
    case 'web-novel':
    case 'translation':
    case 'default':
    default:
      return 'skills/de-ai-writing/SKILL.md'
  }
}

/**
 * 从打包的资源目录读取skill文件
 * @param skillPath 相对于资源目录的skill路径
 * @returns skill内容，失败返回null
 */
async function tryLoadSkillFromBundle(skillPath: string): Promise<string | null> {
  try {
    const resDir = await resourceDir()
    const fullPath = await join(resDir, skillPath)
    const content = await readFile(fullPath)
    return content.trim() || null
  } catch {
    return null
  }
}

/**
 * 智能加载去AI味skill（根据场景自动选择）
 * @param projectPath 项目路径
 * @param userRequest 用户请求文本
 * @param contextPack 上下文包（可选）
 * @returns skill内容，失败返回null（将使用内置规则兜底）
 */
export async function loadSmartDeAiSkill(
  projectPath: string | null,
  userRequest: string,
  contextPack?: ContextPack
): Promise<string | null> {
  if (!projectPath) return null

  // 1. 最高优先：用户自定义 de-ai-skill.txt
  try {
    const customPath = await join(projectPath, "de-ai-skill.txt")
    const customSkill = await readFile(customPath)
    const trimmed = customSkill.trim()
    if (trimmed) return trimmed
  } catch {
    // 用户未自定义，继续自动选择
  }

  // 2. 场景检测
  const genre = detectContentGenre(userRequest, contextPack)

  // 3. 根据场景选择skill
  const skillPath = genreToSkillPath(genre)
  const sceneSkill = await tryLoadSkillFromBundle(skillPath)
  if (sceneSkill) return sceneSkill

  // 4. 保底：返回null，使用内置规则
  return null
}

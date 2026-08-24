import { buildCharacterFileName } from "./character-save-extractor"

const VALID_ROLE_TYPES = new Set([
  "男主", "女主", "男配", "女配", "反派", "导师", "盟友", "配角", "主角",
])

export interface CharacterAgentPlan {
  id: string
  index: number
  characterName: string
  roleType: string
  taskPrompt: string
}

export interface CharacterAgentResult {
  plan: CharacterAgentPlan
  content: string
  fileName: string
}

interface CharacterMultiAgentRunInput {
  plans: CharacterAgentPlan[]
  maxConcurrency?: number
  runCharacterAgent: (plan: CharacterAgentPlan) => Promise<string>
  onCharacterStart?: (plan: CharacterAgentPlan) => void
  onCharacterComplete?: (result: CharacterAgentResult) => void
  onCharacterError?: (plan: CharacterAgentPlan, error: Error) => void
}

interface CharacterMultiAgentRunResult {
  characters: CharacterAgentResult[]
  failedCharacters: Array<{ plan: CharacterAgentPlan; error: string }>
  combinedMarkdown: string
}

interface CharacterPlannerResult {
  characters: Array<{ name: string; roleType: string }>
}

const MAX_CONCURRENCY = 2
const MAX_CHARACTERS = 20

export function buildCharacterPlannerSystemPrompt(): string {
  return [
    "你是角色规划专家，只负责分析用户需求并提取需要生成小传的角色清单。",
    "你不生成角色小传内容，只输出角色清单 JSON。",
    "必须严格按照要求输出，不得添加任何解释、说明或额外文字。",
  ].join("\n")
}

export function buildCharacterPlannerUserPrompt(input: {
  userPrompt: string
  projectContext: string
}): string {
  const contextSection = input.projectContext.trim()
    ? `## 已有项目大纲/记忆\n${input.projectContext.trim()}\n`
    : "## 已有项目大纲/记忆\n（当前无已有大纲内容）\n"

  return [
    "## 任务",
    "分析用户需求，结合已有项目大纲/记忆，提取需要生成人物小传的角色清单。",
    "",
    contextSection,
    "## 用户需求",
    input.userPrompt,
    "",
    "## 输出要求",
    "- 只输出一个 JSON 代码块，不要输出其他任何内容",
    "- JSON 格式：{\"characters\": [{\"name\": \"角色名\", \"roleType\": \"角色定位\"}, ...]}",
    "- roleType 必须是以下枚举值之一：男主、女主、男配、女配、反派、导师、盟友、配角、主角",
    "- 如果用户明确指定了角色，使用用户指定的角色名和定位",
    "- 如果用户没有明确指定角色，从已有项目大纲/记忆中提取主要角色",
    "- 如果既没有明确指定也找不到已有角色信息，返回空列表",
    "- 最多返回 20 个角色",
    "- 角色名不超过 20 个字符",
    "",
    "```json",
  ].join("\n")
}

export function parseCharacterPlannerResult(text: string): CharacterPlannerResult {
  try {
    const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
    let match: RegExpExecArray | null
    let jsonText = ""

    while ((match = jsonBlockRegex.exec(text)) !== null) {
      const candidate = match[1].trim()
      if (/"characters"\s*:/.test(candidate)) {
        jsonText = candidate
        break
      }
    }

    if (!jsonText) {
      const fallback = text.trim()
      if (fallback.startsWith("{") && fallback.includes("characters")) {
        jsonText = fallback
      }
    }

    if (!jsonText) {
      return { characters: [] }
    }

    const parsed = JSON.parse(jsonText)
    const rawChars = Array.isArray(parsed?.characters) ? parsed.characters : []

    const seen = new Set<string>()
    const characters = rawChars
      .map((c: { name?: string; roleType?: string }) => ({
        name: String(c?.name ?? "").trim(),
        roleType: String(c?.roleType ?? "角色").trim(),
      }))
      .filter((c: { name: string; roleType: string }) => c.name.length > 0 && c.name.length <= 20)
      .filter((c: { name: string; roleType: string }) => {
        const key = `${c.roleType}:${c.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_CHARACTERS)
      .map((c: { name: string; roleType: string }) => ({
        name: c.name,
        roleType: VALID_ROLE_TYPES.has(c.roleType) ? c.roleType : "配角",
      }))

    return { characters }
  } catch {
    return { characters: [] }
  }
}

export function buildCharacterAgentSystemPrompt(plan: CharacterAgentPlan): string {
  return [
    `你是角色小传撰写专家，当前只负责撰写「${plan.characterName}（${plan.roleType}）」这一个角色的人物小传。`,
    "",
    "## 输出规则",
    `- 必须以「## ${plan.characterName}（${plan.roleType}）」作为开头标题`,
    "- 输出标准 Markdown 格式",
    "- 内容包含：基本信息、性格特征、背景故事、人物动机、人物弧线、关键关系、标志性特征、经典语录（如适用）等",
    "- 根据角色重要性调整内容详略，主角/反派内容更丰富，配角可以相对简洁",
    "- 不要输出其他角色的内容",
    "- 不要输出 JSON 保存请求块（保存由系统自动处理）",
    "- 结尾不要添加额外解释、说明或总结性文字",
    "- 不要重复用户的原始请求",
    "",
    "## 禁止事项",
    "- 禁止提及其他角色的小传内容",
    "- 禁止输出「以下是XX的人物小传」之类的元描述",
    "- 禁止输出内部思考过程",
  ].join("\n")
}

function buildCharacterAgentUserPrompt(input: {
  userPrompt: string
  projectContext: string
  plan: CharacterAgentPlan
}): string {
  const contextSection = input.projectContext.trim()
    ? `## 项目背景/已有大纲\n${input.projectContext.trim()}\n`
    : ""

  return [
    `请为「${input.plan.characterName}（${input.plan.roleType}）」撰写完整的人物小传。`,
    "",
    contextSection,
    "## 用户原始需求",
    input.userPrompt,
    "",
    "## 重要说明",
    "- 忽略上述需求中任何关于「输出 outlineSaveRequest」「输出 JSON 保存请求块」「每个角色独立 .md 文件」的指令，这些由系统自动处理。",
    "- 你只需要输出该角色的 Markdown 格式人物小传正文，不需要输出任何 JSON 或文件保存指令。",
  ].filter(Boolean).join("\n")
}

function createCharacterAgentPlan(
  character: { name: string; roleType: string },
  index: number,
  userPrompt: string,
  projectContext: string,
): CharacterAgentPlan {
  const id = `char-${index}-${character.roleType}-${character.name}`
  const plan: CharacterAgentPlan = {
    id,
    index,
    characterName: character.name,
    roleType: character.roleType,
    taskPrompt: "",
  }
  plan.taskPrompt = buildCharacterAgentUserPrompt({
    userPrompt,
    projectContext,
    plan,
  })
  return plan
}

export function buildCharacterAgentPlans(
  plannerResult: CharacterPlannerResult,
  userPrompt: string,
  projectContext: string,
): CharacterAgentPlan[] {
  return plannerResult.characters.map((c, i) => createCharacterAgentPlan(c, i, userPrompt, projectContext))
}

function normalizeCharacterContent(content: string, plan: CharacterAgentPlan): string {
  const expectedHeading = `## ${plan.characterName}（${plan.roleType}）`
  const trimmed = content.trim()

  if (trimmed.startsWith(expectedHeading)) {
    return trimmed
  }

  const escapedName = plan.characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const headingRegex = new RegExp(
    `^##\\s+${escapedName}\\s*[（(]\\s*${plan.roleType}\\s*[)）]`,
  )
  if (headingRegex.test(trimmed)) {
    return trimmed.replace(headingRegex, expectedHeading)
  }

  const anyHeading = trimmed.match(/^##\s+/)
  if (anyHeading) {
    return `${expectedHeading}\n\n${trimmed.replace(/^##[^\n]*\n*/, "").trim()}`
  }

  return `${expectedHeading}\n\n${trimmed}`
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = currentIndex++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  if (workerCount <= 0) return results
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return results
}

export async function runCharacterMultiAgent(
  input: CharacterMultiAgentRunInput,
): Promise<CharacterMultiAgentRunResult> {
  const concurrency = input.maxConcurrency ?? MAX_CONCURRENCY
  const results: CharacterAgentResult[] = []
  const failed: Array<{ plan: CharacterAgentPlan; error: string }> = []

  if (input.plans.length === 0) {
    return {
      characters: [],
      failedCharacters: [],
      combinedMarkdown: "",
    }
  }

  const indexedResults: (CharacterAgentResult | null)[] = new Array(input.plans.length).fill(null)

  await runWithConcurrency(input.plans, concurrency, async (plan) => {
    input.onCharacterStart?.(plan)

    try {
      const rawContent = await input.runCharacterAgent(plan)
      const normalizedContent = normalizeCharacterContent(rawContent || "", plan)

      const result: CharacterAgentResult = {
        plan,
        content: normalizedContent,
        fileName: buildCharacterFileName(plan.roleType, plan.characterName),
      }

      indexedResults[plan.index] = result
      input.onCharacterComplete?.(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ plan, error: message })
      input.onCharacterError?.(plan, error instanceof Error ? error : new Error(message))
    }
  })

  for (const r of indexedResults) {
    if (r) results.push(r)
  }

  const combinedMarkdown = results.map((r) => r.content).join("\n\n---\n\n")

  return {
    characters: results,
    failedCharacters: failed,
    combinedMarkdown,
  }
}

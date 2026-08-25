/**
 * 拆书三重验证 + 压力测试 - prompt 构建 + 解析（chaishugushidaotu 分支）
 *
 * 三重验证：V1 跨域佐证 / V2 预测力 / V3 独特性，合并为一次 LLM 调用/单元。
 * 压力测试：apply（换场景）/ boundary（边界反例）/ confusion（混淆取舍）。
 * 解析容错对标 style-prompts：剥代码围栏 + 取最外层 {}，不抛错。
 */
import type {
  PressureTestKind,
  TripleVerifyItem,
} from "./verification-types"

interface VerifyRawItem {
  key: string
  status: string
  detail: string
  evidenceCount?: number
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asInt(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0
}

/** 三重验证通用输出说明（嵌入各技能 prompt） */
const TRIPLE_RULES = [
  "对下面的提取单元执行三重验证，逐项判定：",
  "- crossDomain（跨域佐证）：单元的关键特征在提供的原文证据中是否有至少 2 处相互独立的佐证；evidenceCount 填命中的佐证条数。",
  "- predictive（预测力）：用这个单元能否回答一个原文没明说的新问题（如预测后续剧情/新场景的写法）；不能则 fail。",
  "- unique（独特性）：内容是否具体到这本作品独有，而不是任何小说都适用的套话；套话判 fail。",
  "status 取值：pass（通过）/ warn（勉强通过，有瑕疵）/ fail（不通过），detail 用中文说明判定依据。",
].join("\n")

/** 压力测试通用输出说明 */
const PRESSURE_RULES = [
  "再对单元做压力测试抽检，为指定类型的场景各构造 1 条并判定：",
  "- apply（换场景运用）：把单元迁移到一个新的写作场景，判断是否仍自洽可用。",
  "- boundary（边界反例）：构造一个不应套用该单元的场景，判断单元描述是否明确排除了它。",
  "- confusion（混淆取舍）：构造一个容易与相邻单元混淆的场景，判断能否正确取舍。",
  "每条包含：kind、prompt（测试场景一句话）、verdict（pass/warn/fail）、reason（判定原因）。",
].join("\n")

const OUTPUT_CONTRACT = [
  "只输出一个 JSON 对象（不要围栏、不要解释）：",
  "{",
  '  "triple": [ { "key": "crossDomain|predictive|unique", "status": "pass|warn|fail", "detail": "...", "evidenceCount": 0 } ],',
  '  "pressure": [ { "kind": "apply|boundary|confusion", "prompt": "...", "verdict": "pass|warn|fail", "reason": "..." } ]',
  "}",
].join("\n")

/** 角色单元：三重验证 + 压力测试 prompt */
export function buildCharacterVerifyPrompt(input: {
  characterName: string
  profileText: string
  corpus: string
}): string {
  return [
    `你是拆书质量审计员。请审计下面这个从小说中提取的角色档案的「可复用性」。`,
    "",
    `角色：${input.characterName}`,
    "",
    "角色档案（被审计单元）：",
    input.profileText.slice(0, 4000),
    "",
    "原文语料片段（用于跨域佐证核对）：",
    input.corpus.slice(0, 6000) || "（无原文语料，crossDomain 无法核对请判 fail）",
    "",
    TRIPLE_RULES,
    "",
    PRESSURE_RULES,
    "角色单元的相邻单元是同书其他角色（confusion 场景用「容易认错/混淆的两个角色」构造）。",
    "",
    OUTPUT_CONTRACT,
  ].join("\n")
}

/** 文风单元：三重验证 + 压力测试 prompt */
export function buildStyleVerifyPrompt(input: {
  bookTitle: string
  profileText: string
  samples: string[]
}): string {
  return [
    `你是拆书质量审计员。请审计下面这本作品提取的「文风画像」的可复用性。`,
    "",
    `作品：《${input.bookTitle}》`,
    "",
    "文风画像（被审计单元）：",
    input.profileText.slice(0, 4000),
    "",
    "代表原文样本（用于跨域佐证核对）：",
    input.samples.length > 0
      ? input.samples.map((sample, index) => `样本${index + 1}：${sample}`).join("\n\n").slice(0, 6000)
      : "（无样本，crossDomain 无法核对请判 fail）",
    "",
    TRIPLE_RULES,
    "文风的 predictive 判定示例：能否据此预测本书未提供章节的句子长度、对话密度、比喻用法。",
    "",
    PRESSURE_RULES,
    "文风单元的相邻单元是同书角色 Skill（confusion 场景用「文风约束 vs 角色说话方式」构造）。",
    "",
    OUTPUT_CONTRACT,
  ].join("\n")
}

/** 故事导图单元：三重验证 + 压力测试 prompt */
export function buildStoryVerifyPrompt(input: {
  bookTitle: string
  mapDigest: string
}): string {
  return [
    `你是拆书质量审计员。请审计下面这本作品提取的「故事导图（主线+分支）」的可复用性。`,
    "",
    `作品：《${input.bookTitle}》`,
    "",
    "故事导图摘要（被审计单元，章节→主线事件→分支）：",
    input.mapDigest.slice(0, 8000),
    "",
    TRIPLE_RULES,
    "导图的判定口径：crossDomain=主线事件链与分支是否各自有明确章节来源与触发关系；predictive=能否据此预测后续章节的推进节奏；unique=主线/分支归类是否具体，而非「主角变强」这类泛化套话。",
    "",
    PRESSURE_RULES,
    "故事单元的压力测试类型：apply=迁移到新书能否复用节奏；boundary=什么样的题材不该套用此导图；confusion=主线事件与分支事件混淆时如何取舍。",
    "",
    OUTPUT_CONTRACT,
  ].join("\n")
}

/** 需要跑的压力测试类型（角色 2 条、文风/故事 3 条） */
export function pressureKindsFor(skill: "characters" | "style" | "story"): PressureTestKind[] {
  return skill === "characters"
    ? ["apply", "boundary"]
    : ["apply", "boundary", "confusion"]
}

/** 解析三重验证 + 压力测试结果（容错，不抛错） */
export function parseVerifyResult(
  raw: string,
): {
  triple: TripleVerifyItem[]
  pressure: Array<{ kind: string; prompt: string; verdict: string; reason: string }>
} {
  const fenceStripped = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const objectText = fenceStripped.match(/\{[\s\S]*\}/)?.[0]
  if (!objectText) return { triple: [], pressure: [] }
  try {
    const parsed = JSON.parse(objectText) as Record<string, unknown>
    const tripleRaw = Array.isArray(parsed.triple) ? parsed.triple : []
    const labelMap: Record<string, string> = {
      crossDomain: "跨域佐证",
      predictive: "预测力",
      unique: "独特性",
    }
    const triple: TripleVerifyItem[] = tripleRaw.flatMap((item): TripleVerifyItem[] => {
      if (!item || typeof item !== "object") return []
      const candidate = item as VerifyRawItem
      const key = asString(candidate.key)
      if (key !== "crossDomain" && key !== "predictive" && key !== "unique") return []
      const status = candidate.status === "pass" || candidate.status === "warn" || candidate.status === "fail"
        ? candidate.status
        : "fail"
      return [{
        key,
        label: labelMap[key],
        status,
        detail: asString(candidate.detail),
        evidenceCount: asInt(candidate.evidenceCount),
      }]
    })
    const pressureRaw = Array.isArray(parsed.pressure) ? parsed.pressure : []
    const pressure = pressureRaw.flatMap((item): Array<{ kind: string; prompt: string; verdict: string; reason: string }> => {
      if (!item || typeof item !== "object") return []
      const candidate = item as Record<string, unknown>
      const prompt = asString(candidate.prompt)
      if (!prompt) return []
      return [{
        kind: asString(candidate.kind),
        prompt,
        verdict: candidate.verdict === "pass" || candidate.verdict === "warn" || candidate.verdict === "fail"
          ? candidate.verdict
          : "fail",
        reason: asString(candidate.reason),
      }]
    })
    return { triple, pressure }
  } catch {
    return { triple: [], pressure: [] }
  }
}

/**
 * 同人原作正典（source canon）
 *
 * 同人写作与原创写作的根本差别：原作的**既成事实**是硬约束。
 * 本模块是同人正典的唯一真相来源：
 *
 * - 正典落盘到 `<project>/.novel/fanfic-canon.md`，**按固定路径读取**，
 *   不经过 `searchWiki` 模糊检索——这是它与既有 `canonRules` 最本质的区别。
 * - 正典在落盘时编译成一份可追溯文档：超长原作靠**分片编译**压缩成证据包，
 *   而不是截断丢弃。
 * - 缺证据的内容必须留空，不得把猜测写成正典。
 *
 * 上下文注入见 `context-data-sources.ts` 的 `sourceCanonDataSource`；
 * 大纲提示词注入见 `outline-wizard.ts`。
 */

import { createDirectory, deleteFile, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizeComparablePath } from "@/lib/path-utils"
import { streamChat, type StreamCallbacks } from "@/lib/llm-client"
import type { ChatMessage } from "@/lib/llm-providers"
import { useWikiStore } from "@/stores/wiki-store"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { resolveNovelModel } from "@/lib/novel/model-resolver"

/** 正典所在目录（与既有状态类资产同构）。 */
const FANFIC_CANON_DIR = ".novel"
/** 正典文件名。 */
export const FANFIC_CANON_FILE = "fanfic-canon.md"

/** 注入上下文时的字符上限，避免正典挤掉正文所需的前情。 */
export const FANFIC_CANON_CONTEXT_MAX_CHARS = 8000
/** 单次送进模型的原文上限；超过则分片编译。 */
export const FANFIC_CANON_CHUNK_CHARS = 12000
/** 用户粘贴素材的总量上限，防止意外把整本书塞进表单。 */
export const FANFIC_SOURCE_MATERIAL_MAX_CHARS = 400_000

/** 正典文档路径。 */
export function fanficCanonPath(projectPath: string): string {
  return `${normalizeComparablePath(projectPath)}/${FANFIC_CANON_DIR}/${FANFIC_CANON_FILE}`
}

/**
 * 同人模式。
 *
 * `canon` / `au` / `ooc` / `cp` 是四个标准模式，同时允许用户用一句话描述
 * 自己的边界（例如「原作结局十年后的低魔日后谈」），因此自定义模式是自由文本。
 */
export type FanficModeKey = "canon" | "au" | "ooc" | "cp" | "custom"

export interface FanficModeOption {
  value: FanficModeKey
  label: string
  /** 该模式必须向模型交代清楚的东西。 */
  requirement: string
}

export const FANFIC_MODE_OPTIONS: FanficModeOption[] = [
  {
    value: "canon",
    label: "正典延续",
    requirement: "填补原作未展示的时间段或视角，必须说明填哪一段、从谁的视角。",
  },
  {
    value: "au",
    label: "架空世界",
    requirement: "指明一个分歧点，并严格跟随其后果；说明分歧后哪些原作事实仍然成立。",
  },
  {
    value: "ooc",
    label: "性格重塑",
    requirement: "说明有意偏离的成因与边界，避免读完只是「换了个人」。",
  },
  {
    value: "cp",
    label: "CP 向",
    requirement: "说明关系起点与推进驱动力，让关系变化驱动剧情，且不把任一方压扁。",
  },
  { value: "custom", label: "自定义，由我描述", requirement: "用自己的话写清本作与原作的关系边界。" },
]

/** 标准模式 key，用于判断模式是否为内置模式。 */
const STANDARD_FANFIC_MODE_KEYS = new Set<string>(["canon", "au", "ooc", "cp"])

/** 把模式值渲染成人类可读标签；自定义模式原样返回。 */
export function formatFanficModeLabel(mode: string): string {
  const value = mode.trim()
  if (!value) return ""
  const matched = FANFIC_MODE_OPTIONS.find((option) => option.value === value)
  if (matched && matched.value !== "custom") return `${matched.label}（${matched.value}）`
  return value
}

/** 该模式的内置写法要求；自定义模式返回空串。 */
export function getFanficModeRequirement(mode: string): string {
  const value = mode.trim()
  if (!STANDARD_FANFIC_MODE_KEYS.has(value)) return ""
  return FANFIC_MODE_OPTIONS.find((option) => option.value === value)?.requirement ?? ""
}

/**
 * 同人写作硬规则。
 *
 * 移植自 InkOS `inkos-fanfic-writing` Skill 的六条约束，逐条都可验收。
 */
export const FANFIC_WRITING_RULES: readonly string[] = [
  "原作正典是权威：既成的人物、关系、世界规则、时间线、角色已知信息与标志性限制，不得随意更改。",
  "服从所选同人模式：模式决定哪些可以改、哪些不能改，其余一律按正典处理。",
  "写新的戏剧线，不复读原作场景；新增配角与事件必须服务新线，且能与原作正典区分开。",
  "保留角色辨识度靠动机、认知、节奏和行为选择，不靠抄录原作语句。",
  "原作没有证据时保持留空或向用户发问，绝不把猜测写成正典。",
  "压缩后的资料包是证据，不是臆造缺失正典的许可。",
]

/**
 * 同人正典与「参考拆文 / 人格迁移」的分工。
 *
 * QMAI 原有的参考拆解子系统规定「不得复用原作人物、设定、剧情、表达」。
 * 那条规则约束的是**当作写作范本的另一部作品**，与同人正典的作用对象相反：
 * 同人正典要的正是本作原作的既成事实。两者若不加区分会直接打架，
 * 因此在这里把作用域写死，并随正典一起注入。
 */
export const FANFIC_REFERENCE_SCOPE_NOTE = [
  "## 与「参考拆文」的分工",
  "",
  "- 上文的参考拆文规则（不得复用参考作品的人物、设定、剧情、表达）只约束**拿来当写作范本的那部作品**，不包括本作原作。",
  "- 对**本作原作**：既成事实必须沿用（本页正典即为此），不得替换成本作原创设定。",
  "- 仍然**禁止抄录原作语句**：沿用的是事实，不是文字；名场面用一句话侧面带过即可。",
  "- 允许借鉴参考作品的节奏、冲突推进、爽点安排与章末钩子。",
].join("\n")

export interface FanficCanonMeta {
  mode: string
  sourceName: string
  allowedDeviations: string[]
  compiledAt: string
  sourceChars: number
  /** 是否经过分片压缩编译。 */
  compiled: boolean
  /** 分片数量；单片段为 1。 */
  chunkCount: number
}

export interface BuildFanficCanonInput {
  mode: string
  sourceName: string
  allowedDeviations?: string[]
  canonBody: string
  sourceChars: number
  chunkCount: number
  /** 是否经过分片压缩编译；省略时按分片数推导。 */
  compiled?: boolean
  compiledAt?: string
}

function yamlScalar(value: string): string {
  // 双引号包裹并转义，避免中文书名号/冒号/井号破坏 frontmatter。
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`
}

function yamlList(values: readonly string[]): string[] {
  if (values.length === 0) return ["[]"]
  return values.map((value) => `  - ${yamlScalar(value)}`)
}

/**
 * 组装正典文档。
 *
 * 结构固定，便于 `parseFanficCanonMeta` 稳定回读，也便于用户在编辑器里直接手改。
 */
export function buildFanficCanonDocument(input: BuildFanficCanonInput): string {
  const mode = input.mode.trim()
  const sourceName = input.sourceName.trim()
  const deviations = (input.allowedDeviations ?? []).map((item) => item.trim()).filter(Boolean)
  const compiledAt = input.compiledAt ?? new Date().toISOString()
  const compiled = input.compiled ?? input.chunkCount > 1

  const frontmatter = [
    "---",
    `fanfic_mode: ${yamlScalar(mode)}`,
    `source_name: ${yamlScalar(sourceName)}`,
    "allowed_deviations:",
    ...yamlList(deviations),
    `compiled_at: ${yamlScalar(compiledAt)}`,
    `source_chars: ${input.sourceChars}`,
    `compiled: ${compiled}`,
    `chunk_count: ${input.chunkCount}`,
    "---",
  ]

  const requirement = getFanficModeRequirement(mode)
  // 只过滤 null，保留空串——空串是段间空行，filter(Boolean) 会让标题和正文挤在一起。
  const modeLines = [
    "## 同人模式",
    "",
    `- 模式：${formatFanficModeLabel(mode) || mode}`,
    requirement ? `- 本模式必须交代：${requirement}` : null,
    `- 原作：${sourceName || "（未填写）"}`,
    `- 容许偏离：${deviations.length ? deviations.join("；") : "无（除所选模式本身外，一切按原作正典处理）"}`,
  ].filter((line): line is string => line !== null)

  return [
    ...frontmatter,
    "",
    `# 同人正典（${sourceName || "未命名原作"}）`,
    "",
    ...modeLines,
    "",
    "## 创作硬规则",
    "",
    ...FANFIC_WRITING_RULES.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    FANFIC_REFERENCE_SCOPE_NOTE,
    "",
    "## 正典内容",
    "",
    input.canonBody.trim(),
    "",
  ].join("\n")
}

/** 按逗号切分行内数组，但逗号在引号内时不算分隔符。 */
function splitInlineYamlList(inner: string): string[] {
  const items: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]
    if (quote) {
      current += char
      // 双引号里的 \" 是转义，不结束字符串
      if (char === "\\" && quote === '"' && i + 1 < inner.length) {
        current += inner[i + 1]
        i += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === ",") {
      items.push(current)
      current = ""
      continue
    }
    current += char
  }
  items.push(current)
  return items.map((item) => item.trim()).filter(Boolean)
}

function readYamlListValue(raw: string): string[] {
  const inline = raw.match(/^\[(.*)\]$/)
  if (inline) {
    const inner = inline[1].trim()
    if (!inner) return []
    // 逐项反解转义：写入端 yamlScalar 会转义 " 和 \，读取端必须对称还原，
    // 否则「改写"原作结局"」这类含引号的偏离会带着反斜杠回读。
    return splitInlineYamlList(inner).map(unquoteYamlScalar).filter(Boolean)
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => unquoteYamlScalar(line.slice(2).trim()))
    .filter(Boolean)
}

function unquoteYamlScalar(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  return value
}

/** 读取正典 frontmatter。手改坏了也不抛错，返回 null 让调用方回退。 */
export function parseFanficCanonMeta(content: string): FanficCanonMeta | null {
  const match = content.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!match) return null
  const yaml = match[1]
  const mode = yaml.match(/^fanfic_mode:\s*(.*)$/m)?.[1]
  const sourceName = yaml.match(/^source_name:\s*(.*)$/m)?.[1]
  if (mode === undefined || sourceName === undefined) return null

  // allowed_deviations 可能是行内数组，也可能是后续多行；两种都接。
  let allowedDeviations: string[] = []
  const inlineDeviations = yaml.match(/^allowed_deviations:\s*(\[[^\]]*\])\s*$/m)
  if (inlineDeviations) {
    allowedDeviations = readYamlListValue(inlineDeviations[1])
  } else {
    const blockStart = yaml.search(/^allowed_deviations:\s*$/m)
    if (blockStart >= 0) {
      const rest = yaml.slice(blockStart).replace(/^allowed_deviations:\s*$/m, "")
      const blockLines = rest
        .split("\n")
        .filter((line) => line.trim() === "" || /^\s/.test(line))
        .join("\n")
      allowedDeviations = readYamlListValue(blockLines)
    }
  }

  const number = (key: string): number => {
    const raw = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1]
    const value = Number(unquoteYamlScalar(raw ?? ""))
    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  return {
    mode: unquoteYamlScalar(mode),
    sourceName: unquoteYamlScalar(sourceName),
    allowedDeviations,
    compiledAt: unquoteYamlScalar(yaml.match(/^compiled_at:\s*(.*)$/m)?.[1] ?? ""),
    sourceChars: number("source_chars"),
    compiled: unquoteYamlScalar(yaml.match(/^compiled:\s*(.*)$/m)?.[1] ?? "") === "true",
    chunkCount: number("chunk_count"),
  }
}

/** 取正典正文（去掉 frontmatter），用于注入上下文。 */
export function stripFanficCanonFrontmatter(content: string): string {
  return content.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, "").trim()
}

/** 读取正典；不存在或不可读时返回空串（原创项目就是这条路）。 */
export async function loadFanficCanon(projectPath: string): Promise<string> {
  try {
    const path = fanficCanonPath(projectPath)
    if (!(await fileExists(path))) return ""
    return await readFile(path)
  } catch {
    return ""
  }
}

/** 读取正典正文（去 frontmatter、截断到上下文上限）。 */
export async function loadFanficCanonBody(
  projectPath: string,
  maxChars: number = FANFIC_CANON_CONTEXT_MAX_CHARS,
): Promise<string> {
  const content = await loadFanficCanon(projectPath)
  if (!content.trim()) return ""
  const body = stripFanficCanonFrontmatter(content)
  if (!body) return ""
  return body.length > maxChars ? `${body.slice(0, maxChars).trimEnd()}\n\n[正典内容已按上下文预算截断]` : body
}

/** 落盘正典。 */
export async function saveFanficCanon(projectPath: string, document: string): Promise<string> {
  const pp = normalizeComparablePath(projectPath)
  await createDirectory(`${pp}/${FANFIC_CANON_DIR}`)
  const path = fanficCanonPath(pp)
  await writeFileAtomic(path, document)
  return path
}

/** 删除正典（用户改回原创时调用）。文件不存在时静默成功。 */
export async function clearFanficCanon(projectPath: string): Promise<void> {
  try {
    const path = fanficCanonPath(projectPath)
    if (await fileExists(path)) await deleteFile(path)
  } catch {
    // 清理失败不应中断用户的模式切换
  }
}

export class FanficCanonNotReadyError extends Error {
  constructor() {
    super("尚未配置可用的模型，无法编译原作正典。请先在设置中完成模型配置。")
    this.name = "FanficCanonNotReadyError"
  }
}

/** 校验模型可用性，与既有 ingest 前的闸门保持一致。 */
export function assertFanficCanonLlmReady(): void {
  const state = useWikiStore.getState()
  const runtimeLlmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "extract")
  if (!hasUsableLlm(runtimeLlmConfig, state.providerConfigs)) {
    throw new FanficCanonNotReadyError()
  }
}

/**
 * 按字符上限切分原作素材。
 *
 * 优先在段落边界切，避免把一句话劈成两半送给模型。
 */
export function splitFanficSourceMaterial(
  sourceMaterial: string,
  chunkChars: number = FANFIC_CANON_CHUNK_CHARS,
): string[] {
  const text = sourceMaterial.trim()
  if (!text) return []
  if (chunkChars <= 0 || text.length <= chunkChars) return [text]

  const chunks: string[] = []
  const paragraphs = text.split(/\n{2,}/)
  let current = ""
  for (const paragraph of paragraphs) {
    // 单个段落就超限时，退化为按字符硬切。
    if (paragraph.length > chunkChars) {
      if (current.trim()) {
        chunks.push(current.trim())
        current = ""
      }
      for (let start = 0; start < paragraph.length; start += chunkChars) {
        chunks.push(paragraph.slice(start, start + chunkChars))
      }
      continue
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > chunkChars) {
      chunks.push(current.trim())
      current = paragraph
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

export interface FanficCanonChunkPromptInput {
  sourceName: string
  mode: string
  chunk: string
  index: number
  total: number
}

/** 构造单片段编译提示词。纯函数，便于断言「只保留有证据的内容」。 */
export function buildFanficCanonChunkPrompt(input: FanficCanonChunkPromptInput): ChatMessage[] {
  const modeLabel = formatFanficModeLabel(input.mode) || input.mode
  const requirement = getFanficModeRequirement(input.mode)
  return [
    {
      role: "system",
      content: [
        "你是同人创作的原作资料整理助手。你的输出会成为后续写作的权威正典，因此准确性优先于完整性。",
        "",
        "硬性要求：",
        "1. 只保留原作素材中**有明确证据**的内容；没有证据的字段直接省略，不要推测、不要补全。",
        "2. 为每条事实保留可追溯线索（出自哪一段/哪一章/哪个人物之口）。",
        "3. 不要发明原作里不存在的体系、等级、势力或专有名词。",
        "4. 输出 Markdown，按维度分节，不要输出寒暄或解释。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `原作：《${input.sourceName}》`,
        `同人模式：${modeLabel}`,
        requirement ? `本模式必须交代：${requirement}` : null,
        `片段：${input.index + 1}/${input.total}`,
        "",
        "请从下列原作素材中，整理出对同人创作有用的正典事实，建议覆盖：",
        "- 世界观与硬规则（不可违背的设定）",
        "- 主要人物：身份、性格、语言习惯、能力边界、已知信息",
        "- 关键关系与阵营",
        "- 时间线与已发生的关键事件",
        "- 标志性限制与禁忌",
        "",
        "## 原作素材",
        input.chunk,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    },
  ]
}

/** 构造汇总提示词：把分片证据包合成一份正典。 */
export function buildFanficCanonMergePrompt(input: {
  sourceName: string
  mode: string
  allowedDeviations: readonly string[]
  chunkNotes: readonly string[]
}): ChatMessage[] {
  const modeLabel = formatFanficModeLabel(input.mode) || input.mode
  const requirement = getFanficModeRequirement(input.mode)
  return [
    {
      role: "system",
      content: [
        "你是同人创作的原作资料整理助手。请把多个分片证据包合并成一份**唯一的**原作正典文档。",
        "",
        "硬性要求：",
        "1. 合并重复项，冲突时保留证据更充分的一条并标注冲突，不要两说并陈。",
        "2. 只保留证据支持的内容，缺失即留空或写「原作未交代」，不得臆造。",
        "3. 用 Markdown 分节输出，不要输出寒暄、不要重复各分片的原文。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `原作：《${input.sourceName}》`,
        `同人模式：${modeLabel}`,
        requirement ? `本模式必须交代：${requirement}` : null,
        `容许偏离：${input.allowedDeviations.length ? input.allowedDeviations.join("；") : "无"}`,
        "",
        "以下是逐段整理出的证据包，请合并为一份正典：",
        "",
        ...input.chunkNotes,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    },
  ]
}

async function collectChatText(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const state = useWikiStore.getState()
  const llmConfig = resolveNovelModel(state.llmConfig, state.novelConfig, "extract")
  let result = ""
  let streamError: Error | null = null
  const callbacks: StreamCallbacks = {
    onToken: (token: string) => {
      result += token
    },
    onDone: () => {},
    onError: (error: Error) => {
      streamError = error
    },
  }
  await streamChat(llmConfig, messages, callbacks, signal)
  if (streamError) throw streamError
  return result.trim()
}

export interface CompileFanficCanonInput {
  projectPath: string
  sourceMaterial: string
  sourceName: string
  mode: string
  allowedDeviations?: string[]
  signal?: AbortSignal
  onProgress?: (message: string, index: number, total: number) => void
}

export interface CompileFanficCanonResult {
  path: string
  document: string
  chunkCount: number
  compiled: boolean
  sourceChars: number
}

/**
 * 把用户提供的原作素材编译成正典并落盘。
 *
 * 超长素材先逐片整理成证据包，再合并——这样几百万字的原作也能进正典，
 * 而不是被截断丢掉后半本。
 */
export async function compileFanficCanon(
  input: CompileFanficCanonInput,
): Promise<CompileFanficCanonResult> {
  assertFanficCanonLlmReady()

  const sourceMaterial = input.sourceMaterial.trim()
  const sourceName = input.sourceName.trim()
  const mode = input.mode.trim()
  if (!sourceMaterial) throw new Error("原作素材为空，无法编译正典。")
  if (!sourceName) throw new Error("请先填写原作名称，无法编译正典。")
  if (!mode) throw new Error("请先选择同人模式，无法编译正典。")
  if (sourceMaterial.length > FANFIC_SOURCE_MATERIAL_MAX_CHARS) {
    throw new Error(
      `原作素材过长（${sourceMaterial.length} 字符，上限 ${FANFIC_SOURCE_MATERIAL_MAX_CHARS}）。请分批导入。`,
    )
  }

  const chunks = splitFanficSourceMaterial(sourceMaterial)
  const allowedDeviations = (input.allowedDeviations ?? []).map((item) => item.trim()).filter(Boolean)
  const compiled = chunks.length > 1
  let canonBody: string

  if (!compiled) {
    input.onProgress?.("正在编译原作正典…", 0, 1)
    canonBody = await collectChatText(
      buildFanficCanonChunkPrompt({ sourceName, mode, chunk: chunks[0] ?? "", index: 0, total: 1 }),
      input.signal,
    )
  } else {
    const notes: string[] = []
    for (let index = 0; index < chunks.length; index += 1) {
      input.onProgress?.(`正在整理原作片段 ${index + 1}/${chunks.length}…`, index, chunks.length)
      const note = await collectChatText(
        buildFanficCanonChunkPrompt({
          sourceName,
          mode,
          chunk: chunks[index],
          index,
          total: chunks.length,
        }),
        input.signal,
      )
      if (note) notes.push(`### 片段 ${index + 1}/${chunks.length}\n\n${note}`)
    }
    if (notes.length === 0) throw new Error("正典编译未返回任何内容，请检查模型配置或原作素材。")
    input.onProgress?.("正在合并正典…", chunks.length, chunks.length)
    canonBody = await collectChatText(
      buildFanficCanonMergePrompt({ sourceName, mode, allowedDeviations, chunkNotes: notes }),
      input.signal,
    )
  }

  if (!canonBody.trim()) throw new Error("正典编译未返回任何内容，请检查模型配置或原作素材。")

  const document = buildFanficCanonDocument({
    mode,
    sourceName,
    allowedDeviations,
    canonBody,
    sourceChars: sourceMaterial.length,
    chunkCount: chunks.length,
    compiled,
  })
  const path = await saveFanficCanon(input.projectPath, document)
  return { path, document, chunkCount: chunks.length, compiled, sourceChars: sourceMaterial.length }
}

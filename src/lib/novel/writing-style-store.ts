/**
 * 作品文风预设的项目级启用态 + 生成注入（feature/book-style-extraction → feature/writing-dna）
 *
 * 镜像 character-aura 的 store 范式：存盘在 <projectPath>/.qmai/writing-style.json。
 * 启用某个文风后，buildWritingStyleContext() 把"整合 DNA + 代表片段"拼成注入文本，
 * 由 context-engine 接入 contextPack.writingStyle，
 * 经 contextPackToPrompt 流向普通对话与深度生成各阶段（含缓存前缀）。
 *
 * 对齐 writing-dna-skill 第六节「每次写作前必读」：注入的不只是压缩后的整合文档，
 * 还要按当次写作任务从 chapter-meta 里检索体裁题材最接近的原文片段——
 * 具体语感（句子呼吸、段落怎么接）只存在于原文里，整合文档描述不出来。
 *
 * 红线：只注入蒸馏结果 + 少量短片段，绝不注入整本原文。
 */
import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"
import { migrateStyleProfile } from "./book-analysis/style-profile-schema"
import type { BookStyleProfile } from "./book-analysis/types"
import { compileStyleFingerprint } from "./book-analysis/style-fingerprint"

export interface WritingStylePreset {
  id: string
  name: string
  sourceBook: string
  profile: BookStyleProfile
  sourceBookId?: string
  evidenceIds?: string[]
  createdAt: number
  updatedAt: number
}

interface WritingStyleStore {
  version: 1
  enabledStyleId: string | null
  styles: WritingStylePreset[]
}

interface BuildWritingStyleContextOptions {
  includeSamples?: boolean
  constitutionCharLimit?: number
  samplesCharLimit?: number
  /** 本次写作任务描述；用于按体裁题材检索最接近的原文片段。 */
  task?: string
  /** 检索原文的条数，对齐 writing-dna-skill 的「读 5 篇」。 */
  relevantChapterCount?: number
  /**
   * 本次生成临时覆盖的文风预设 id（丁-2：「文风写作」选择器）。
   *
   * 三态**不能混用**（`undefined` 与 `null` 语义相反）：
   * - `undefined`（不传）：**没有覆盖**，照旧读项目启用的那一项；
   * - `null`：用户显式选了「本次不用文风」，返回 `""`（真的不注入）；
   * - `string`：用这个预设渲染。
   *
   * ⚠️ 覆盖文本**必须**由这个同一个渲染器产出（不要另写一套拼装）：
   * `contextPackToPrompt`（`context-engine.ts:1132`）的文风 fail-closed 守卫判的是
   * **字面前缀** `【已启用文风画像】`，只有同形才能保证覆盖与「已启用」路径
   * 要么都触发守卫、要么都不触发。详见本文件 buildWritingStyleContext 的注释。
   */
  styleIdOverride?: string | null
}

const DEFAULT_CONSTITUTION_LIMIT = 800
const DEFAULT_SAMPLES_LIMIT = 2500
/**
 * 整合文档正文的注入预算（已摘掉硬约束小节，硬约束单独注入）。
 * 刻意压得比落盘上限 INTEGRATED_DNA_CHAR_LIMIT 紧：writingStyle 在 trimContextPack 里
 * 排在第 19 位，是整段丢弃而不是逐字截断，payload 越大越容易被整段丢掉。
 * 完整文档仍在 Writing-DNA.md 里，供人和 agent 直接读。
 */
const DEFAULT_DNA_BODY_LIMIT = 1800
const DEFAULT_RELEVANT_CHAPTER_COUNT = 5
/** 每条检索片段的长度上限：只用来校准语感，不是给素材。 */
const RETRIEVED_EXCERPT_CHARS = 300

function storePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/writing-style.json`
}

export async function loadWritingStyleStore(projectPath: string): Promise<WritingStyleStore> {
  try {
    const raw = await readFile(storePath(projectPath))
    const parsed = JSON.parse(raw) as Partial<WritingStyleStore>
    return {
      version: 1,
      enabledStyleId: typeof parsed.enabledStyleId === "string" ? parsed.enabledStyleId : null,
      styles: Array.isArray(parsed.styles) ? parsed.styles : [],
    }
  } catch {
    return { version: 1, enabledStyleId: null, styles: [] }
  }
}

async function saveWritingStyleStore(projectPath: string, store: WritingStyleStore): Promise<void> {
  await createDirectory(`${normalizePath(projectPath)}/.qmai`)
  await writeFileAtomic(storePath(projectPath), JSON.stringify(store, null, 2))
}

/**
 * 写入/更新一个文风预设（按 sourceBook 去重：同一本书只保留一份，重复提取则覆盖）。
 * 不改变当前启用项。返回该预设 id。
 */
export async function upsertWritingStylePreset(
  projectPath: string,
  input: {
    name: string
    sourceBook: string
    profile: BookStyleProfile
    sourceBookId?: string
    evidenceIds?: string[]
  },
): Promise<WritingStylePreset> {
  const store = await loadWritingStyleStore(projectPath)
  const now = Date.now()
  const existingIndex = store.styles.findIndex((s) => s.sourceBook === input.sourceBook)
  let preset: WritingStylePreset
  if (existingIndex >= 0) {
    preset = {
      ...store.styles[existingIndex],
      name: input.name,
      profile: input.profile,
      sourceBookId: input.sourceBookId,
      evidenceIds: input.evidenceIds,
      updatedAt: now,
    }
    store.styles[existingIndex] = preset
  } else {
    preset = {
      id: `style-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name,
      sourceBook: input.sourceBook,
      profile: input.profile,
      sourceBookId: input.sourceBookId,
      evidenceIds: input.evidenceIds,
      createdAt: now,
      updatedAt: now,
    }
    store.styles.push(preset)
  }
  await saveWritingStyleStore(projectPath, store)
  return preset
}

export async function setEnabledWritingStyle(projectPath: string, styleId: string | null): Promise<WritingStyleStore> {
  const store = await loadWritingStyleStore(projectPath)
  const next: WritingStyleStore = {
    ...store,
    enabledStyleId: styleId && store.styles.some((s) => s.id === styleId) ? styleId : null,
  }
  await saveWritingStyleStore(projectPath, next)
  return next
}

/**
 * 删除预设的公共实现（拆书库「删除条目」要连使用库一起真删）。
 *
 * 两个要点：
 *  1. 删掉的正好是当前启用项时必须把 enabledStyleId 置 null——否则留下一个
 *     指向不存在预设的悬空启用项，getEnabledWritingStyle 会静默返回 null，
 *     而盘上的状态看起来「还在启用文风」。
 *  2. 删不到目标时不抛错、store 内容不变（删除接口要可重入：重复点删除、
 *     或删一个手动清理过的预设，都不该报错）。
 */
async function removeWritingStylePresets(
  projectPath: string,
  match: (preset: WritingStylePreset) => boolean,
): Promise<WritingStyleStore> {
  const store = await loadWritingStyleStore(projectPath)
  const styles = store.styles.filter((preset) => !match(preset))
  const enabledRemoved = store.enabledStyleId !== null
    && !styles.some((preset) => preset.id === store.enabledStyleId)
  const next: WritingStyleStore = {
    ...store,
    styles,
    enabledStyleId: enabledRemoved ? null : store.enabledStyleId,
  }
  await saveWritingStyleStore(projectPath, next)
  return next
}

/** 按 id 删除一个文风预设。 */
export async function removeWritingStylePreset(projectPath: string, styleId: string): Promise<WritingStyleStore> {
  return removeWritingStylePresets(projectPath, (preset) => preset.id === styleId)
}

/**
 * 按来源作品删除文风预设。
 * 一本书最多只有一个预设（upsertWritingStylePreset 按 sourceBook 去重），
 * 拆书结果「删除某个文风对象」即删掉整版这一个预设。
 */
export async function removeWritingStylePresetBySourceBook(projectPath: string, sourceBook: string): Promise<WritingStyleStore> {
  return removeWritingStylePresets(projectPath, (preset) => preset.sourceBook === sourceBook)
}

export async function getEnabledWritingStyle(projectPath: string): Promise<WritingStylePreset | null> {
  const store = await loadWritingStyleStore(projectPath)
  if (!store.enabledStyleId) return null
  const preset = store.styles.find((s) => s.id === store.enabledStyleId)
  if (!preset) return null
  // 盘上可能是 v1 数据，统一迁移成 v2 形状再交给调用方
  return { ...preset, profile: migrateStyleProfile(preset.profile) }
}

/**
 * 按「本次是否覆盖」的三态取预设（丁-2）。
 *
 * 把三态收在一个函数里，是为了让 `buildWritingStyleContext` 的取值口径只有一处：
 * - `undefined` → 项目启用项（**就是** `getEnabledWritingStyle`，不另写一份）；
 * - `null` → `null`（本次显式不用文风，调用方据此返回 `""`）；
 * - `string` → 该预设；找不到（例如选中后又被删掉）也返回 `null`。
 *
 * ⚠️ 找到预设时**必须**照 `getEnabledWritingStyle:186` 再迁移一次
 * `migrateStyleProfile`：那是字段归一化 / 防崩 / 形状一致，
 * **不是**渲染分支选择器（分支只看 `profile.workbenchStyle?.styleFingerprint`，
 * 见 `migrateStyleProfile` 从不创建也不删除该字段）。不迁移就直接渲染，
 * 存量 v1 数据上的 `constitution` 可能是 `undefined`，
 * 而渲染里的 `clip()` 会 `.trim()` → **直接抛错**。
 *
 * ⚠️ 未知 id 按「本次没有可用文风」处理（返回 `null` → 文本 `""`），
 * **不**回退到项目启用项：那会让用户以为生效的是自己刚选的那条，
 * 实际用的却是另一条 —— 静默用错比静默不用更难发现。
 */
export async function resolveWritingStylePreset(
  projectPath: string,
  styleIdOverride?: string | null,
): Promise<WritingStylePreset | null> {
  if (styleIdOverride === null) return null
  if (styleIdOverride === undefined) return getEnabledWritingStyle(projectPath)
  const store = await loadWritingStyleStore(projectPath)
  const preset = store.styles.find((s) => s.id === styleIdOverride)
  if (!preset) return null
  return { ...preset, profile: migrateStyleProfile(preset.profile) }
}

function clip(value: string, limit: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}…`
}

function bookPathFor(projectPath: string, bookId: string): string {
  return joinPath(normalizePath(projectPath), "book-analysis", bookId)
}

/**
 * 按本次写作任务检索题材最接近的原文片段。
 * 拿不到 chapter-meta（旧数据或 fast 模式没标注）时返回空数组，由调用方回落到已有样本。
 */
async function retrieveRelevantExcerpts(
  projectPath: string,
  bookId: string,
  task: string,
  limit: number,
): Promise<string[]> {
  const bookPath = bookPathFor(projectPath, bookId)
  const [{ loadChapterMeta, selectRelevantChapters, excerptChapterBody }] = await Promise.all([
    import("./book-analysis/chapter-meta"),
  ])
  const collection = await loadChapterMeta(bookPath)
  if (collection.entries.length === 0) return []
  const picked = selectRelevantChapters(collection.entries, task, limit)

  const excerpts: string[] = []
  for (const entry of picked) {
    try {
      const raw = await readFile(joinPath(bookPath, "chapters", `${entry.chapterId}.md`))
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
      const excerpt = excerptChapterBody(body, RETRIEVED_EXCERPT_CHARS)
      if (excerpt) excerpts.push(excerpt)
    } catch {
      // 章节文件缺失就跳过，不因为一章读不到而放弃整次注入
    }
  }
  return excerpts
}

/**
 * 把当前启用的文风预设拼成注入文本（无启用项返回 ""）。
 *
 * 内容优先级：整合 Writing DNA > 风格硬约束（v1 数据或整合缺失时降级）。
 * 参考片段优先级：按任务检索的原文 > 已启用 evidence > profile.samples。
 * 内含红线：只学写法、不借片段里的人物/地名/设定/情节。
 *
 * `options.styleIdOverride` 让本次生成临时换成另一条预设（丁-2），
 * 走的是**下面同一个** `renderWritingStylePreset`：覆盖文本与「已启用」
 * 路径逐字节同形，两者要么都带 `【已启用文风画像】` 前缀、要么都不带。
 *
 * ── ⚠️ 已确认的不对称（选择 (a)：照现状接受，不在本批改变）──
 * `contextPackToPrompt` 的文风 fail-closed 守卫判的是**字面前缀**
 * （`context-engine.ts:1132`），而前缀**只在结构化画像分支**加
 * （下面 `lines.unshift("【已启用文风画像】")` 那一支）。
 * 于是 `profile.workbenchStyle` 为空的 **v1/旧画像**预设：
 * 无论「已启用」还是「本次临时覆盖」，都**不带**前缀、都**不触发**守卫，
 * 被预算整段裁掉时都是静默的。
 * 这是**既有行为**（本批没有改变它）：覆盖路径**不会比**「已启用」路径更不安全，
 * 但也**不是**「覆盖一定受守卫保护」。
 * ⚠️ 本批**不**给旧画像补前缀：那会把今天能静默截断并成功出稿的旧画像项目
 * 变成硬停机（`context-engine.ts:1133` 抛错），是用户可见的行为变更。
 */
export async function buildWritingStyleContext(
  projectPath: string,
  options: BuildWritingStyleContextOptions = {},
): Promise<string> {
  const preset = await resolveWritingStylePreset(projectPath, options.styleIdOverride)
  if (!preset) return ""
  return renderWritingStylePreset(projectPath, preset, options)
}

/**
 * 由**已经取好的** preset 拼注入文本。`buildWritingStyleContext` 的唯一渲染入口
 * —— 覆盖路径与启用路径共用它，避免出现第二套文案/第二种形状。
 */
async function renderWritingStylePreset(
  projectPath: string,
  preset: WritingStylePreset,
  options: BuildWritingStyleContextOptions,
): Promise<string> {
  const {
    includeSamples = true,
    constitutionCharLimit = DEFAULT_CONSTITUTION_LIMIT,
    samplesCharLimit = DEFAULT_SAMPLES_LIMIT,
    task = "",
    relevantChapterCount = DEFAULT_RELEVANT_CHAPTER_COUNT,
  } = options

  const lines: string[] = [
    `目标文风来源：《${preset.sourceBook}》。`,
    "只模仿这种叙事密度、描写克制度、句式与节奏。严禁借用下方参考片段中的人物、地名、设定、情节——它们只是文风样例，不是剧情素材。",
    "",
  ]

  const structuredStyle = preset.profile.workbenchStyle?.styleFingerprint ? preset.profile.workbenchStyle : undefined
  if (structuredStyle) {
    lines[1] = "依据已核验的语言习惯写作，保持目标故事事实，不扮演或冒充原作者。参考片段只校准语言，不借用人物、地名、设定和情节，不照抄句子。"
    lines.unshift("【已启用文风画像】")
    lines.push(compileStyleFingerprint(structuredStyle))
  } else {
    // 旧画像仍按原预算处理；结构化画像不按字数切掉后面的维度。
    lines.push("风格硬约束：", clip(preset.profile.constitution, constitutionCharLimit))
  }

  const integratedDna = preset.profile.integratedDna?.trim()
  if (integratedDna && !structuredStyle) {
    const { stripConstitutionSection } = await import("./book-analysis/writing-dna-prompts")
    const body = stripConstitutionSection(integratedDna)
    if (body) {
      lines.push("", "Writing DNA 要点（写作时逐条对照）：", clip(body, DEFAULT_DNA_BODY_LIMIT))
    }
  }

  let samples: string[] = []
  let sampleLabel = "文风参考片段（只学写法，不要照抄内容）："

  if (preset.sourceBookId && task.trim()) {
    try {
      samples = await retrieveRelevantExcerpts(
        projectPath,
        preset.sourceBookId,
        task,
        relevantChapterCount,
      )
      if (samples.length > 0) {
        sampleLabel = "题材最接近的原文片段（用来校准句子呼吸与段落衔接，只学写法，不要照抄内容）："
      }
    } catch {
      samples = []
    }
  }

  if (samples.length === 0 && preset.sourceBookId && preset.evidenceIds?.length) {
    const { loadEvidence } = await import("./book-analysis/analysis-evidence-store")
    const collection = await loadEvidence(bookPathFor(projectPath, preset.sourceBookId))
    const selectedIds = new Set(preset.evidenceIds)
    samples = collection.snippets
      .filter((item) => item.skill === "style" && item.enabled && selectedIds.has(item.id))
      .map((item) => item.text)
  }

  if (samples.length === 0) samples = preset.profile.samples

  if (includeSamples && samples.length > 0) {
    const sampleLines: string[] = []
    let used = 0
    for (const sample of samples) {
      const text = sample.trim()
      if (!text) continue
      if (used + text.length > samplesCharLimit) break
      used += text.length
      sampleLines.push(`- ${text}`)
    }
    if (sampleLines.length > 0) {
      lines.push("", sampleLabel, ...sampleLines)
    }
  }

  return lines.join("\n")
}

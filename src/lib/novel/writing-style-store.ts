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

export async function getEnabledWritingStyle(projectPath: string): Promise<WritingStylePreset | null> {
  const store = await loadWritingStyleStore(projectPath)
  if (!store.enabledStyleId) return null
  const preset = store.styles.find((s) => s.id === store.enabledStyleId)
  if (!preset) return null
  // 盘上可能是 v1 数据，统一迁移成 v2 形状再交给调用方
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
 */
export async function buildWritingStyleContext(
  projectPath: string,
  options: BuildWritingStyleContextOptions = {},
): Promise<string> {
  const preset = await getEnabledWritingStyle(projectPath)
  if (!preset) return ""
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

  // 硬约束永远排在最前：它是最可执行的部分，不能因为整合文档太长而被挤掉
  lines.push("风格硬约束：", clip(preset.profile.constitution, constitutionCharLimit))

  const integratedDna = preset.profile.integratedDna?.trim()
  if (integratedDna) {
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

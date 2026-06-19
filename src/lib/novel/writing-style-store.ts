/**
 * 作品文风预设的项目级启用态 + 生成注入（feature/book-style-extraction）
 *
 * 镜像 character-aura 的 store 范式：存盘在 <projectPath>/.qmai/writing-style.json。
 * 启用某个文风后，buildWritingStyleContext() 把"风格宪法 + 代表样本"拼成注入文本，
 * 由 context-engine 的 readWritingStyle 接入 contextPack.writingStyle，
 * 经 contextPackToPrompt 流向普通对话与深度生成各阶段（含缓存前缀）。
 *
 * 红线：只注入蒸馏后的宪法 + 少量短样本，绝不注入整本原文。
 */
import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { BookStyleProfile } from "./book-analysis/types"

export interface WritingStylePreset {
  id: string
  name: string
  sourceBook: string
  profile: BookStyleProfile
  createdAt: number
  updatedAt: number
}

export interface WritingStyleStore {
  version: 1
  enabledStyleId: string | null
  styles: WritingStylePreset[]
}

export interface BuildWritingStyleContextOptions {
  includeSamples?: boolean
  constitutionCharLimit?: number
  samplesCharLimit?: number
}

const DEFAULT_CONSTITUTION_LIMIT = 800
const DEFAULT_SAMPLES_LIMIT = 2500

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

export async function saveWritingStyleStore(projectPath: string, store: WritingStyleStore): Promise<void> {
  await createDirectory(`${normalizePath(projectPath)}/.qmai`)
  await writeFileAtomic(storePath(projectPath), JSON.stringify(store, null, 2))
}

/**
 * 写入/更新一个文风预设（按 sourceBook 去重：同一本书只保留一份，重复提取则覆盖）。
 * 不改变当前启用项。返回该预设 id。
 */
export async function upsertWritingStylePreset(
  projectPath: string,
  input: { name: string; sourceBook: string; profile: BookStyleProfile },
): Promise<WritingStylePreset> {
  const store = await loadWritingStyleStore(projectPath)
  const now = Date.now()
  const existingIndex = store.styles.findIndex((s) => s.sourceBook === input.sourceBook)
  let preset: WritingStylePreset
  if (existingIndex >= 0) {
    preset = { ...store.styles[existingIndex], name: input.name, profile: input.profile, updatedAt: now }
    store.styles[existingIndex] = preset
  } else {
    preset = {
      id: `style-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name,
      sourceBook: input.sourceBook,
      profile: input.profile,
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
  return store.styles.find((s) => s.id === store.enabledStyleId) ?? null
}

function clip(value: string, limit: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}…`
}

/**
 * 把当前启用的文风预设拼成注入文本（无启用项返回 ""）。
 * 内含硬约束：只学文风、不借样本中的人物/地名/设定/情节。
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
  } = options

  const lines: string[] = [
    `目标文风来源：《${preset.sourceBook}》。`,
    "只模仿这种叙事密度、描写克制度、句式与节奏。严禁借用下方参考片段中的人物、地名、设定、情节——它们只是文风样例，不是剧情素材。",
    "",
    "风格硬约束：",
    clip(preset.profile.constitution, constitutionCharLimit),
  ]

  if (includeSamples && preset.profile.samples.length > 0) {
    const sampleLines: string[] = []
    let used = 0
    for (const sample of preset.profile.samples) {
      const text = sample.trim()
      if (!text) continue
      if (used + text.length > samplesCharLimit) break
      used += text.length
      sampleLines.push(`- ${text}`)
    }
    if (sampleLines.length > 0) {
      lines.push("", "文风参考片段（只学写法，不要照抄内容）：", ...sampleLines)
    }
  }

  return lines.join("\n")
}

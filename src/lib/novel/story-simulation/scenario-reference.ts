/**
 * 舞台情景的「参考点」资料注入。
 *
 * 背景：「参考点」此前只是一句写进提示词的话 ——
 *   「参考点（必须以此为依据）：《中庸》」
 * 模型除了这个书名之外什么也没拿到，所谓「必须以此为依据」无从谈起。对话
 * 路径也没有推演室里那套工具能力，模型没办法自己去查。于是这个字段实际
 * 是一个空承诺。
 *
 * 这里把承诺补上：拿参考点去项目 wiki 检索，把命中的资料正文注入提示词。
 *
 * 几个刻意的取舍：
 * - 检索失败一律吞掉（返回空），情景必须照常开演。资料是锦上添花，不能因为
 *   项目里没有 wiki 目录就让功能不可用。
 * - 有预算上限。整库灌进上下文既贵又会把角色设定挤掉，宁少勿滥；截断时如实
 *   标记，不假装资料完整。
 * - 读不到正文时退回搜索片段，而不是丢掉这条命中 —— 片段至少说明「这里提过」。
 */

import { readFile } from "@/commands/fs"
import { searchWiki, type SearchResult } from "@/lib/search"

/** 最多注入几篇资料。 */
export const SCENARIO_REFERENCE_TOP_K = 5
/** 单篇资料的正文预算（字符）。 */
export const SCENARIO_REFERENCE_PER_SOURCE_CHARS = 1200
/** 全部资料合计的预算（字符）。 */
export const SCENARIO_REFERENCE_MAX_CHARS = 4000

const TRUNCATION_MARK = "\n……（已截断）"

export interface ScenarioReferenceMaterial {
  /** 可直接拼进提示词的资料正文；没有命中时为空串。 */
  text: string
  /** 实际注入的资料路径，用于向用户交代「依据了哪些资料」。 */
  sources: string[]
  /** 是否发生过截断（单篇或总量）。 */
  truncated: boolean
}

const EMPTY: ScenarioReferenceMaterial = {
  text: "",
  sources: [],
  truncated: false,
}

export interface ScenarioReferenceDeps {
  search: (projectPath: string, query: string) => Promise<SearchResult[]>
  read: (path: string) => Promise<string>
}

const DEFAULT_DEPS: ScenarioReferenceDeps = {
  search: (projectPath, query) =>
    searchWiki(projectPath, query, { topK: SCENARIO_REFERENCE_TOP_K }),
  read: readFile,
}

/**
 * 按参考点检索项目资料，整理成可注入的文本。
 *
 * 永不抛出：任何一步失败都退化成「没有资料」，让调用方不必为资料检索包一层
 * try/catch，也不会因为项目里没有 wiki 就让情景开不了场。
 */
export async function collectScenarioReferenceMaterial(
  projectPath: string,
  reference: string,
  deps: ScenarioReferenceDeps = DEFAULT_DEPS,
): Promise<ScenarioReferenceMaterial> {
  const query = reference.trim()
  if (!query) return EMPTY

  let hits: SearchResult[]
  try {
    hits = await deps.search(projectPath, query)
  } catch {
    return EMPTY
  }
  if (!Array.isArray(hits) || hits.length === 0) return EMPTY

  const picked = hits.slice(0, SCENARIO_REFERENCE_TOP_K)
  const blocks: string[] = []
  const sources: string[] = []
  let truncated = false
  let used = 0

  for (const hit of picked) {
    const body = await readBody(hit, deps)
    if (!body.trim()) continue

    let chunk = body.trim()
    if (chunk.length > SCENARIO_REFERENCE_PER_SOURCE_CHARS) {
      chunk = chunk.slice(0, SCENARIO_REFERENCE_PER_SOURCE_CHARS) + TRUNCATION_MARK
      truncated = true
    }

    const block = `### ${hit.title}\n${chunk}`
    // 超预算就停在这里：与其把后面的资料切一半，不如整篇不带
    if (used + block.length > SCENARIO_REFERENCE_MAX_CHARS) {
      truncated = true
      break
    }

    blocks.push(block)
    sources.push(hit.path)
    used += block.length
  }

  if (blocks.length === 0) return { ...EMPTY, truncated }

  return {
    text: blocks.join("\n\n"),
    sources,
    truncated,
  }
}

/** 正文优先；读不到（文件被删/是目录/无权限）就退回搜索片段。 */
async function readBody(
  hit: SearchResult,
  deps: ScenarioReferenceDeps,
): Promise<string> {
  try {
    return await deps.read(hit.path)
  } catch {
    return hit.snippet ?? ""
  }
}

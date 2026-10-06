/**
 * 意图澄清选项解析：模型经常把候选全塞进 missingItems 而把 options 留空，
 * 导致「需求分析」卡片只剩一大段说明、一个可点的按钮都没有。
 * 这里按可靠性依次兜底，保证用户永远有得选，最后一项固定是「自定义」。
 */

import type { OutlineListEntry } from "@/lib/agent/tools/outline-list-helpers"
import type { IntentClarityOption, IntentClarityResult } from "./outline-intent-clarity"

export const CUSTOM_INTENT_OPTION_ID = "custom"

/** 模型选项最多取用条数，避免弹窗被长列表淹没。 */
const MAX_MODEL_OPTIONS = 8
/** 兜底候选最多取用条数。 */
const MAX_DERIVED_OPTIONS = 8
/** 候选条目要像「第X卷/章」这类可生成单位，才认为括号里是清单。 */
const UNIT_CANDIDATE_PATTERN = /第?\s*[0-9一二三四五六七八九十百零]+\s*[卷章节部篇集回]/
const ENUMERATION_SEPARATOR_PATTERN = /\s*[/、,，;；|]\s*/

const CUSTOM_OPTION: IntentClarityOption = {
  id: CUSTOM_INTENT_OPTION_ID,
  label: "自定义",
  description: "自己填写本次要生成的范围",
}

function withCustom(options: IntentClarityOption[]): IntentClarityOption[] {
  return [...options, CUSTOM_OPTION]
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/^[（(【\[]+/, "").replace(/[）)】\]]+$/, "").trim()
}

/** 剔除缺 ID 或缺标题的残缺选项，这类选项渲染出来是空按钮。 */
function usableOptions(options: IntentClarityOption[] | undefined): IntentClarityOption[] {
  return (options ?? [])
    .filter((option) => Boolean(option?.id?.trim()) && Boolean(option?.label?.trim()))
    .map((option) => ({ ...option, label: option.label.trim() }))
    .slice(0, MAX_MODEL_OPTIONS)
}

/**
 * 从缺失项文本里解析候选清单。
 * 只认「括号内被分隔符切出、且多数条目形如『第X卷/章』」的组，
 * 否则会把「10故事×10环节＋volumeOutlineData」这种说明当成选项。
 */
function deriveFromMissingItems(missingItems: string[]): IntentClarityOption[] {
  const options: IntentClarityOption[] = []
  const seen = new Set<string>()

  const push = (label: string, description: string) => {
    const clean = normalizeLabel(label)
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    options.push({ id: `missing-${options.length + 1}`, label: clean, description })
  }

  for (const item of missingItems) {
    const reason = normalizeLabel(item.split(/[（(]/)[0] ?? "") || "需要确认生成范围"
    for (const match of item.matchAll(/[（(]([^（()）]{2,})[）)]/g)) {
      const parts = (match[1] ?? "").split(ENUMERATION_SEPARATOR_PATTERN).map(normalizeLabel).filter(Boolean)
      if (parts.length < 2) continue
      const unitLike = parts.filter((part) => UNIT_CANDIDATE_PATTERN.test(part))
      if (unitLike.length * 2 < parts.length) continue
      for (const part of unitLike) push(part, reason)
    }
  }

  return options.slice(0, MAX_DERIVED_OPTIONS)
}

/**
 * 最后的文字兜底：把缺失项本身当成「需要你定的那件事」。
 * 只在既没有模型选项、也没有结构化候选、项目里也找不到相关文档时使用。
 */
function deriveFromRawMissingItems(missingItems: string[]): IntentClarityOption[] {
  const options: IntentClarityOption[] = []
  const seen = new Set<string>()
  for (const item of missingItems) {
    const label = normalizeLabel(item)
    if (!label || seen.has(label)) continue
    seen.add(label)
    options.push({
      id: `missing-raw-${options.length + 1}`,
      label: label.length > 46 ? `${label.slice(0, 46)}…` : label,
      description: "本轮需要确认的范围",
    })
  }
  return options.slice(0, MAX_DERIVED_OPTIONS)
}

/** 兜底到项目里真实存在、且与本模块相关的文档，作为补充/修订候选。 */
function deriveFromEntries(
  entries: OutlineListEntry[],
  module: string,
): IntentClarityOption[] {
  const key = module.replace(/[小传设定体系计划检查]/g, "").trim() || module
  const matched = entries.filter((entry) => {
    const path = entry.relativePath
    if (entry.folder && (entry.folder.includes(key) || key.includes(entry.folder))) return true
    return path.includes(key)
  })

  return matched.slice(0, MAX_DERIVED_OPTIONS).map((entry, index) => {
    const name = entry.relativePath.split("/").pop()?.replace(/\.md$/i, "") ?? entry.relativePath
    return {
      id: `existing-${index + 1}`,
      label: `补《${name}》`,
      description: `项目里已有 ${entry.relativePath}，选它表示在此基础上补充或修订`,
    }
  })
}

/**
 * 解析本轮「需求分析」要呈现给用户的选项。
 * 顺序：模型选项 → 缺失项结构化候选 → 项目已有文档 → 缺失项原文 → 仅「自定义」。
 * 前三级都比「把整句话当选项」更有用，所以原文兜底排在项目文档之后。
 */
export function resolveIntentOptions(
  result: IntentClarityResult,
  entries: OutlineListEntry[] = [],
): IntentClarityOption[] {
  const fromModel = usableOptions(result.options)
  if (fromModel.length > 0) return withCustom(fromModel)

  const fromMissing = deriveFromMissingItems(result.missingItems ?? [])
  if (fromMissing.length > 0) return withCustom(fromMissing)

  const fromEntries = deriveFromEntries(entries, result.module ?? "")
  if (fromEntries.length > 0) return withCustom(fromEntries)

  return withCustom(deriveFromRawMissingItems(result.missingItems ?? []))
}

export function isCustomIntentOption(optionId: string): boolean {
  return optionId === CUSTOM_INTENT_OPTION_ID
}

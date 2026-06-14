/**
 * 拆书 6 维度分析 - 6 维度提取引擎
 *
 * 输入：ExtractedCharacter + 完整语料 + LLM 配置
 * 输出：在 character 上填充 aliasMap / sixDimensionMeta / sixDimensionResearch
 *
 * 深度选项：
 *   - fast: 不调用 LLM / 不调 web，直接把 character 已有字段映射到 6 个维度
 *   - standard: 6 次 LLM 调用，无 web 搜索
 *   - deep: 6 次 LLM 调用 + 1 次 web 搜索（DuckDuckGo/Wikipedia）
 *
 * 进度回调单位：1/6/7
 */

import type { LlmConfig } from "@/stores/wiki-store"
import type {
  AnalysisDepth,
  ExtractedCharacter,
  SixDimensionKey,
  SixDimensionProgressItem,
  SixDimensionResearch,
  SixDimensionStatus,
} from "./types"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import {
  ALL_DIMENSIONS,
  DIMENSION_LABELS,
  PROMPT_BUILDERS,
  type PromptInput,
} from "./six-dimension-prompts"
import { buildNameAliasMap } from "./alias-resolver"
import { fetchCharacterExternalMaterial } from "./web-search"

export interface SixDimensionInput {
  character: ExtractedCharacter
  /** 该角色对应的全部章节语料（已拼好） */
  corpus: string
  llmConfig: LlmConfig
  depth: AnalysisDepth
  bookTitle: string
  bookAuthor?: string
  onProgress?: (p: SixDimensionProgress) => void
  signal?: AbortSignal
}

/**
 * 6 维度细粒度进度（feature/book-analysis-6d-skill）
 *
 * 字段含义：
 * - stage  当前阶段：init / fetching_web / dimension / done / error
 * - label  阶段可读标签，如 "正在提取：01 公开资料"
 * - completed / total / percentage  整体进度
 * - currentItem  当前正在做的事的简短描述
 * - currentDimension  当前正在做哪个维度
 * - dimensions  6 维度完整状态清单（UI 可直接渲染）
 * - characterName  当前处理到的角色名（让上层知道"6 维度分析中"是哪个角色）
 */
export interface SixDimensionProgress {
  stage: "init" | "fetching_web" | "dimension" | "done" | "error"
  label: string
  completed: number
  total: number
  percentage: number
  currentItem?: string
  currentDimension?: SixDimensionKey
  dimensions?: SixDimensionProgressItem[]
  characterName?: string
}

export interface SixDimensionResult {
  character: ExtractedCharacter
  webSearchUsed: boolean
  llmFallbackUsed: boolean
}

/**
 * 构造一个"6 个维度初始状态"数组
 */
function buildDimensionsState(): SixDimensionProgressItem[] {
  return ALL_DIMENSIONS.map((key) => ({
    key,
    label: DIMENSION_LABELS[key],
    status: "pending" as SixDimensionStatus,
  }))
}

/** 复制并设置某一项的 status（不修改原数组） */
function setItemStatus(
  arr: SixDimensionProgressItem[],
  key: SixDimensionKey,
  status: SixDimensionStatus
): SixDimensionProgressItem[] {
  return arr.map((it) => (it.key === key ? { ...it, status } : it))
}

/** fast 模式：把 character 已有字段映射成 6 维度（占位/模板） */
function fastResearch(character: ExtractedCharacter): SixDimensionResearch {
  return {
    publicMaterial:
      `## 人物定位\n${character.description || "原文未直接给出"}\n\n## 基础设定\n${character.personality || "原文未直接给出"}\n\n## 能力 / 技能 / 实力\n${character.speechStyle || "原文未直接给出"}`,
    speechStyle:
      `## 语气 / 腔调\n${character.speechStyle || "原文未直接给出"}\n\n## 典型对话片段\n（fast 模式：未抽取）`,
    expressionDna: `## 行为模式\n${character.personality || "原文未直接给出"}\n\n## 备注\n（fast 模式：未抽取详细表达特征）`,
    externalViews: `## 综合印象\n${character.description || "原文未直接给出"}\n\n## 备注\n（fast 模式：未抽取外部评价）`,
    decisionLog: `## 决策风格\n${character.personality || "原文未直接给出"}\n\n## 备注\n（fast 模式：未抽取决策记录）`,
    timeline: `## 关键转折点\n出现 ${character.appearanceCount} 次\n\n## 备注\n（fast 模式：未抽取时间线）`,
  }
}

/** 单维度 LLM 调用（流式） */
async function callLlmForDimension(
  llmConfig: LlmConfig,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const messages: ChatMessage[] = [{ role: "user", content: prompt }]
  let response = ""
  await streamChat(
    llmConfig,
    messages,
    {
      onToken: (text) => {
        response += text
      },
      onDone: () => {},
      onError: (err) => {
        console.error("[six-dimension] LLM error:", err)
      },
    },
    signal
  )
  return response.trim()
}

/**
 * 主函数：执行 6 维度分析并把结果回填到 character
 */
export async function analyzeSixDimensions(
  input: SixDimensionInput
): Promise<SixDimensionResult> {
  const { character, corpus, llmConfig, depth, bookTitle, bookAuthor, onProgress, signal } = input
  const totalSteps = depth === "fast" ? 1 : depth === "deep" ? 7 : 6
  const characterName = character.name

  // 1) 名称归一
  const aliasMap = buildNameAliasMap(character.name, character.aliases)
  character.aliasMap = aliasMap

  // 2) fast 模式直接返回
  if (depth === "fast") {
    const research = fastResearch(character)
    character.sixDimensionResearch = research
    character.sixDimensionMeta = {
      depth,
      schemaVersion: 1,
      generatedAt: Date.now(),
      webSearchUsed: false,
      llmFallbackUsed: false,
      sourceNote: "快速模式：未调用 LLM，未进行 web 搜索",
    }
    const fastDims = buildDimensionsState().map((it, i) => ({
      ...it,
      status: (i < 6 ? "done" : "pending") as SixDimensionStatus,
    }))
    onProgress?.({
      stage: "done",
      label: "完成",
      completed: 1,
      total: 1,
      percentage: 100,
      currentItem: "快速模式完成",
      dimensions: fastDims,
      characterName,
    })
    return { character, webSearchUsed: false, llmFallbackUsed: false }
  }

  // 3) 准备外部评价资料（仅 deep 模式）
  let externalMaterial: string | undefined
  let webSearchUsed = false
  let llmFallbackUsed = false
  let dimensionsState = buildDimensionsState()

  if (depth === "deep") {
    onProgress?.({
      stage: "fetching_web",
      label: "正在获取外部公开资料…",
      completed: 0,
      total: totalSteps,
      percentage: Math.round((0 / totalSteps) * 100),
      currentItem: "DuckDuckGo / Wikipedia",
      dimensions: dimensionsState,
      characterName,
    })
    try {
      const result = await fetchCharacterExternalMaterial(
        character.name,
        bookTitle,
        signal
      )
      if (result) {
        externalMaterial = `来源：${result.source}\n标题：${result.title}\nURL：${result.url}\n\n摘要：\n${result.abstract}`
        webSearchUsed = true
      } else {
        llmFallbackUsed = true
      }
    } catch {
      llmFallbackUsed = true
    }
  }

  // 4) 6 维度 LLM 调用
  const research: SixDimensionResearch = {
    publicMaterial: "",
    speechStyle: "",
    expressionDna: "",
    externalViews: "",
    decisionLog: "",
    timeline: "",
  }

  const promptInput: PromptInput = {
    character: { ...character, aliasMap },
    corpus,
    externalMaterial,
    bookTitle,
    bookAuthor,
  }

  for (let i = 0; i < ALL_DIMENSIONS.length; i++) {
    const key = ALL_DIMENSIONS[i]
    const builder = PROMPT_BUILDERS[key]
    const label = DIMENSION_LABELS[key]
    const stepIndex = depth === "deep" ? i + 1 : i

    // 进入维度：状态 running
    let runningState = setItemStatus(dimensionsState, key, "running")
    onProgress?.({
      stage: "dimension",
      label: `正在提取：${label}`,
      completed: stepIndex,
      total: totalSteps,
      percentage: Math.round((stepIndex / totalSteps) * 100),
      currentItem: `${characterName} · ${label}`,
      currentDimension: key,
      dimensions: runningState,
      characterName,
    })

    if (signal?.aborted) {
      throw new Error("aborted")
    }

    const prompt = builder(promptInput)
    try {
      const text = await callLlmForDimension(llmConfig, prompt, signal)
      research[key] = text || `（${label} 提取失败或返回空）`
      runningState = setItemStatus(runningState, key, "done")
    } catch (e) {
      research[key] = `（${label} 提取失败：${(e as Error).message}）`
      runningState = setItemStatus(runningState, key, "failed")
    }

    // 维度完成：再发一次进度（更新清单和百分比）
    onProgress?.({
      stage: "dimension",
      label: `已提取：${label}`,
      completed: stepIndex,
      total: totalSteps,
      percentage: Math.round(((i + 1) / totalSteps) * 100),
      currentItem: `${characterName} · ${label}`,
      currentDimension: key,
      dimensions: runningState,
      characterName,
    })

    // 把当次循环产生的最新状态回填到 dimensionsState，
    // 这样循环结束后的"done"进度能拿到所有维度都是 done 的清单
    dimensionsState = runningState
  }

  // 5) 回填
  character.sixDimensionResearch = research

  const sourceNote =
    depth === "deep"
      ? webSearchUsed
        ? `深度模式：6 维度 LLM + 已获取外部资料（${llmFallbackUsed ? "部分兜底" : "完整"}）`
        : "深度模式：6 维度 LLM + 外部资料获取失败，已由 LLM 基于原文兜底"
      : "标准模式：6 维度 LLM，未进行 web 搜索"

  character.sixDimensionMeta = {
    depth,
    schemaVersion: 1,
    generatedAt: Date.now(),
    webSearchUsed,
    llmFallbackUsed,
    sourceNote,
  }

  onProgress?.({
    stage: "done",
    label: "完成",
    completed: totalSteps,
    total: totalSteps,
    percentage: 100,
    currentItem: "全部维度提取完成",
    dimensions: dimensionsState,
    characterName,
  })

  return { character, webSearchUsed, llmFallbackUsed }
}

/**
 * 重新跑 6 维度（用于旧 skill 的"重跑"按钮）
 */
export async function reanalyzeSixDimensions(
  input: SixDimensionInput
): Promise<SixDimensionResult> {
  return await analyzeSixDimensions(input)
}

/**
 * 深度选择时给用户显示的提示
 */
export const DEPTH_DESCRIPTIONS: Record<AnalysisDepth, { label: string; description: string; approxTokenMultiplier: string }> = {
  fast: {
    label: "快速",
    description: "使用已有信息生成 6 维度模板，不调用 LLM，token 消耗约 1×。",
    approxTokenMultiplier: "1×",
  },
  standard: {
    label: "标准",
    description: "调用 LLM 提取全部 6 个维度，不联网。质量与 token 平衡。",
    approxTokenMultiplier: "6×",
  },
  deep: {
    label: "完整",
    description: "调用 LLM 提取 6 个维度，并尝试通过 DuckDuckGo/Wikipedia 获取公开资料作为外部评价来源。",
    approxTokenMultiplier: "6×+网络",
  },
}

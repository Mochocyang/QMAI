/**
 * 文风自进化的**接线层**：把引擎接到真实文件系统与真实模型上，并负责并发守卫。
 *
 * 引擎（`style-evolution-engine.ts`）刻意只收注入的 IO，自己被测试得干干净净；
 * 所有「真实世界」的东西都收在这里：读章节、剥 frontmatter、解析模型配置、
 * 调 `callAnalysisModelText`（而不是直接 `streamChat`），以及**同一项目的并发守卫**。
 *
 * ── 为什么必须有 in-flight 守卫 ──────────────────────────────────
 * 调用点是 `App.tsx` 的 `hydrateDeferredProjectState`，它被 `void` 调用
 * （`:576`，不 await、没有锁），而 `handleProjectOpened` 一天有 4 个入口。
 * 引擎内部虽然用 `lastAttemptedOn` 拦住了「同一天第二次尝试」，但那是**落盘后**
 * 才生效的；两次调用若在同一个 tick 里并发起跑，两边都可能读到「今天还没试过」
 * 的旧状态。守卫放在这里，比散在每个调用点可靠。
 */
import { createDirectory, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizePath, joinPath } from "@/lib/path-utils"
import { useWikiStore } from "@/stores/wiki-store"
import { decodeWritingSources, normalizeCountableText, writingTextHash } from "@/lib/writing-stats"
import {
  loadWritingStats,
  writingStatsChapterKey,
  type WritingStatsChapterEntry,
} from "@/lib/writing-stats-persistence"
import { callAnalysisModelText } from "./book-analysis/analysis-model-call"
import { resolveTaskLlmConfig } from "./book-analysis/analysis-model-resolver"
import {
  runStyleEvolutionRound,
  type StyleEvolutionChapter,
  type StyleEvolutionRoundResult,
} from "./style-evolution-engine"
import { loadStyleEvolutionState } from "./style-evolution-store"

/** 排错日志只留最近这么多行。 */
const MAX_LOG_LINES = 200

/** 正在跑的项目（规范化路径）。同一项目同时只允许一轮。 */
const inFlight = new Set<string>()

/** 仅供测试：清空并发守卫。 */
export function resetStyleEvolutionInFlight(): void {
  inFlight.clear()
}

/** 该项目当前是否有一轮在跑。 */
export function isStyleEvolutionRunning(projectPath: string): boolean {
  return inFlight.has(normalizePath(projectPath))
}

/** 章节文件名的自然排序键：`chapter-010.md` 要排在 `chapter-9.md` 前面。 */
function chapterSortKey(name: string): [number, string] {
  const numeric = name.match(/(\d+)/)
  return [numeric ? Number(numeric[1]) : Number.MAX_SAFE_INTEGER, name]
}

/**
 * 读用户自己写的章节正文。
 *
 * 只读 `wiki/chapters/*.md` 的**直接子项**：正文就在这里，别的目录
 * （`soul.md`、设定集、大纲）是元数据，混进来会把「文风」量成「设定文档的写法」。
 */
export async function collectProjectChapterBodies(projectPath: string): Promise<string[]> {
  return (await collectProjectChapters(projectPath)).map((chapter) => chapter.body)
}

/**
 * 这一章里仍是 AI 原样写下的字占比，数据来自写作统计的逐字归属账本
 * （聊天保存、Agent 写章、批量去 AI 味等写盘入口都会记 `ai`）。
 * 账本与当前正文对不上（带外修改、统计还没落盘）时返回 null：无从得知，不猜。
 */
export function chapterAiRatio(entry: WritingStatsChapterEntry | undefined, markdown: string): number | null {
  if (!entry || entry.len === 0) return null
  const text = normalizeCountableText(markdown)
  if (text.length !== entry.len || writingTextHash(text) !== entry.hash) return null
  const sources = decodeWritingSources(entry.rle, text.length)
  if (!sources) return null
  return sources.filter((source) => source === "ai").length / sources.length
}

/**
 * 同 {@link collectProjectChapterBodies}，另带每章的 key（文件名 + 字数）与 AI 字占比。
 * 新写的章节、改过的章节都会换 key，引擎的新素材闸门靠它判断有没有新东西可分析。
 */
export async function collectProjectChapters(projectPath: string): Promise<StyleEvolutionChapter[]> {
  const chaptersDir = joinPath(normalizePath(projectPath), "wiki", "chapters")
  let entries: Awaited<ReturnType<typeof listDirectory>>
  try {
    entries = await listDirectory(chaptersDir)
  } catch {
    // 还没有 chapters 目录（新项目）——不是错误，只是没样本。
    return []
  }

  const files = entries
    .filter((entry) => !entry.is_dir && /\.md$/i.test(entry.name))
    .sort((a, b) => {
      const [an, as] = chapterSortKey(a.name)
      const [bn, bs] = chapterSortKey(b.name)
      return an - bn || as.localeCompare(bs)
    })

  let ledger: Record<string, WritingStatsChapterEntry> = {}
  try {
    ledger = (await loadWritingStats(projectPath)).chapters
  } catch {
    // 没有统计就全部按「无从得知」处理
  }

  const chapters: StyleEvolutionChapter[] = []
  for (const file of files) {
    try {
      const raw = await readFile(file.path)
      // 剥掉 frontmatter：它是 YAML 元数据（人物、时间线），不是作者的行文。
      // 混进去会污染句长与标点密度。
      const { body } = parseFrontmatter(raw)
      const text = body.trim()
      if (!text) continue
      chapters.push({
        key: `${file.name}:${text.length}`,
        body: text,
        aiRatio: chapterAiRatio(ledger[writingStatsChapterKey(projectPath, file.path)], raw),
      })
    } catch {
      // 单个章节读不出来就跳过：不能因为一个坏文件让整轮作废。
    }
  }
  return chapters
}

function styleEvolutionLogPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/style-evolution.log`
}

/**
 * 每轮结果追加一行到 `.qmai/style-evolution.log`。面板按用户要求不再显示状态与历史，
 * 「为什么一直没进化」只能靠这份日志查。写失败不影响本轮结果。
 */
async function appendStyleEvolutionLog(projectPath: string, result: StyleEvolutionRoundResult): Promise<void> {
  if (result.status === "skipped-disabled" || result.status === "skipped-not-due") return
  const path = styleEvolutionLogPath(projectPath)
  const line = JSON.stringify({
    at: new Date().toISOString(),
    status: result.status,
    outcome: result.outcome,
    reason: result.reason,
    distanceCandidate: result.distanceCandidate,
    distanceBase: result.distanceBase,
    stylePresetId: result.stylePresetId,
    sampleNote: result.sampleNote,
  })
  try {
    let previous = ""
    try {
      previous = await readFile(path)
    } catch {
      // 第一次写
    }
    const lines = [...previous.split("\n").filter(Boolean), line].slice(-MAX_LOG_LINES)
    await createDirectory(`${normalizePath(projectPath)}/.qmai`)
    await writeFileAtomic(path, `${lines.join("\n")}\n`)
  } catch (error) {
    console.warn("[Style Evolution] 写日志失败:", error instanceof Error ? error.message : error)
  }
}

/** 新候选写进文风库时提示用户：候选需要用户点一下才启用，不提示就没人知道它在那儿。 */
function notifyCandidate(result: StyleEvolutionRoundResult): void {
  if (result.status !== "completed" || !result.stylePresetId) return
  if (result.outcome !== "kept" && result.outcome !== "bootstrap") return
  useWikiStore.getState().setStyleEvolutionNotice?.({
    stylePresetId: result.stylePresetId,
    name: result.stylePresetName ?? "自动进化文风",
    outcome: result.outcome,
  })
}

export interface StyleEvolutionRunDeps {
  collectChapterBodies?: (projectPath: string) => Promise<Array<string | StyleEvolutionChapter>>
  callModel?: (prompt: string) => Promise<string>
  now?: string
  rng?: () => number
}

/**
 * 跑一个项目的自进化 tick。
 *
 * **永不抛错**：任何异常都收敛成 `incomplete` 结果或 `null`（已有并发轮次时）。
 * 调用方（`App.tsx`）是 `void` 调用的，抛出去会变成未处理的 Promise 拒绝。
 */
export async function runStyleEvolutionTick(
  projectPath: string,
  deps: StyleEvolutionRunDeps = {},
): Promise<StyleEvolutionRoundResult | null> {
  const key = normalizePath(projectPath)
  if (!key) return null

  // 同一项目已有轮次在跑 ⇒ 直接放弃这一次，不排队、不等待。
  if (inFlight.has(key)) return null
  inFlight.add(key)

  try {
    const collectChapterBodies = deps.collectChapterBodies ?? collectProjectChapters
    const callModel = deps.callModel ?? defaultCallModel

    const result = await runStyleEvolutionRound(key, {
      collectChapterBodies: () => collectChapterBodies(key),
      callModel,
      now: deps.now,
      rng: deps.rng,
    })
    await appendStyleEvolutionLog(key, result)
    try {
      notifyCandidate(result)
    } catch {
      // 提示失败不影响结果
    }
    return result
  } catch (error) {
    // 引擎内部已兜住自己的异常；到这里说明是接线层（读目录/解析配置）出的问题。
    // 仍要交出真实状态，而不是造一个空壳 —— 面板读的是这个 state。
    const message = error instanceof Error ? error.message : String(error)
    const state = await loadStyleEvolutionState(key).catch(() => null)
    if (!state) return null
    return {
      status: "incomplete",
      reason: `文风自进化启动失败：${message}`,
      state,
    }
  } finally {
    inFlight.delete(key)
  }
}

/**
 * 默认模型调用：走拆书库共享的 `callAnalysisModelText`。
 *
 * ⚠️ **不要**改成直接 `streamChat`。这条链路可能遇到「模型把预算全烧在思考上、
 * 一个正文字符都不吐」——那条流在 HTTP 层是成功的，只有
 * `callAnalysisModelText` 会丢掉半截输出、关掉思考整轮重发。
 * `analysis-model-call.guard.spec.ts` 有一道绊线专门盯着这个文件。
 */
async function defaultCallModel(prompt: string): Promise<string> {
  const llmConfig = resolveTaskLlmConfig({})
  return callAnalysisModelText(
    llmConfig,
    [
      {
        role: "system",
        content:
          "你是严谨的中文小说文风分析员。只按要求输出，不寒暄、不解释、不加代码块围栏。",
      },
      { role: "user", content: prompt },
    ],
    { cancelMessage: "用户取消文风自进化" },
  )
}

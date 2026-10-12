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
import { listDirectory, readFile } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizePath, joinPath } from "@/lib/path-utils"
import { callAnalysisModelText } from "./book-analysis/analysis-model-call"
import { resolveTaskLlmConfig } from "./book-analysis/analysis-model-resolver"
import { runStyleEvolutionRound, type StyleEvolutionRoundResult } from "./style-evolution-engine"
import { loadStyleEvolutionState } from "./style-evolution-store"

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

  const bodies: string[] = []
  for (const file of files) {
    try {
      const raw = await readFile(file.path)
      // 剥掉 frontmatter：它是 YAML 元数据（人物、时间线），不是作者的行文。
      // 混进去会污染句长与标点密度。
      const { body } = parseFrontmatter(raw)
      const text = body.trim()
      if (text) bodies.push(text)
    } catch {
      // 单个章节读不出来就跳过：不能因为一个坏文件让整轮作废。
    }
  }
  return bodies
}

export interface StyleEvolutionRunDeps {
  collectChapterBodies?: (projectPath: string) => Promise<string[]>
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
    const collectChapterBodies = deps.collectChapterBodies ?? collectProjectChapterBodies
    const callModel = deps.callModel ?? defaultCallModel

    return await runStyleEvolutionRound(key, {
      collectChapterBodies: () => collectChapterBodies(key),
      callModel,
      now: deps.now,
      rng: deps.rng,
    })
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

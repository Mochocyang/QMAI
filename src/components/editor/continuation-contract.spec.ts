import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const wikiEditorSource = readFileSync(resolve(__dirname, "wiki-editor.tsx"), "utf8")
const previewPanelSource = readFileSync(resolve(__dirname, "../layout/preview-panel.tsx"), "utf8")

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`源码里找不到起点标记：${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (end < 0) throw new Error(`源码里找不到终点标记：${endMarker}`)
  return source.slice(start, end)
}

/** 取一个「以 startMarker 开头、到它的依赖数组那一行为止」的代码块。 */
function callbackBlock(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`源码里找不到：${startMarker}`)
  /*
   * 依赖数组那一行长这样：`  }, [...]`（preview-panel 里缩进 2）
   * 或 `    }, [...]`（wiki-editor 的 effect 里缩进 4）。所以允许 2–6 个空格，
   * 只写死 2 个会匹配不到后者，然后一路找到别的函数的结尾 —— 断言看着通过，
   * 其实查的是另一段代码。
   *
   * 缩进必须写成 `[ \t]` 而不是 `\s`：`\s` 连换行一起匹配，配合 `m` 标志会
   * 跨行凑出「行首 + 若干空白 + }, [」，于是可能提前匹配到别的函数的结尾。
   */
  const end = /^[ \t]{2,6}\}, \[[^\n]*/m.exec(source.slice(start))
  if (!end || end.index === undefined) throw new Error(`找不到 ${startMarker} 的依赖数组结尾`)
  /*
   * 抽出来的块必须真的以 startMarker 开头、以 `}, [` 结尾。
   *
   * 终点行本身也要切进来（末尾那个 `+ end[0].length`）。少了它有两个后果，
   * 而且都是**静默**失效，不会报错：
   * ① 下面那句 `/\}, \[/.test(block)` 永远为假 —— 块切到终点行之前，所以
   *    连正确抽取都会抛「抽取结果不合理」；
   * ② 「依赖数组里不能有 value」那类 not.toContain 断言恒为真 —— 依赖数组
   *    根本不在块里，改坏了也测不出来。
   */
  const block = source.slice(start, start + end.index + end[0].length)
  if (!block.startsWith(startMarker) || !/\}, \[/.test(block)) {
    throw new Error(`${startMarker} 的代码块抽取结果不合理`)
  }
  return block
}

describe("续写：只有章节正文才有", () => {
  it("章节右键菜单的首项是「续写」，且九项齐全", () => {
    const declaration = /const CHAPTER_CONTEXT_ACTIONS:[\s\S]*?= \[([\s\S]*?)\]/.exec(wikiEditorSource)
    expect(declaration).not.toBeNull()
    const actions = [...declaration![1].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1])
    expect(actions[0]).toBe("continue")
    expect(actions).toEqual([
      "continue", "undo", "redo", "copy", "cut", "paste", "selectAll", "find", "replace",
    ])
  })

  it("大纲编辑器用同一个菜单组件，但不得给出续写入口", () => {
    const outline = sliceBetween(wikiEditorSource, "function WikiEditorInner(", "interface WikiEditorProps")
    // 不传 actions → 走 DEFAULT_ITEMS，而默认项里没有续写
    expect(outline).toContain("EditorContextMenu")
    expect(outline).not.toContain("actions=")
    expect(outline).not.toContain("onContinuationRequest")
  })
})

describe("续写：归因与写回", () => {
  it("插入正文必须登记为 AI 生成，并且立即落盘", () => {
    const block = callbackBlock(previewPanelSource, "const handleInsertContinuation = useCallback(")
    expect(block).toContain('{ source: "ai", immediate: true }')
  })

  it("插入前必须先校验正文快照，拒绝过期锚点", () => {
    const block = callbackBlock(previewPanelSource, "const handleInsertContinuation = useCallback(")
    // 走的是带快照校验的 insertContinuationBody，而不是直接拼字符串
    expect(block).toContain("insertContinuationBody(currentBody, anchor, continuationCandidate)")
    expect(block).toContain("if (!inserted.ok)")
  })

  it("插入后按偏移量定位光标，而不是按文本查找", () => {
    const block = callbackBlock(previewPanelSource, "const handleInsertContinuation = useCallback(")
    expect(block).toContain("setContinuationCaretRequest({ at: inserted.caret")
    const editor = callbackBlock(wikiEditorSource, "if (!caretRequest) return;")
    expect(editor).toContain("textarea.setSelectionRange(at, at)")
    // 按文本查找会定位到第一处重复；这里必须只用偏移量
    expect(editor).not.toContain("indexOf")
  })

  it("光标夹取发生在 rAF 内、按当时的 DOM 值算（否则会拿到旧 value 把光标压回原处）", () => {
    const editor = callbackBlock(wikiEditorSource, "if (!caretRequest) return;")
    const frameAt = editor.indexOf("requestAnimationFrame")
    const clampAt = editor.indexOf("Math.min(caretRequest.at, textarea.value.length)")
    expect(frameAt).toBeGreaterThanOrEqual(0)
    expect(clampAt).toBeGreaterThan(frameAt)
    // 依赖数组里不能有 value：放了会每敲一个字就抢一次光标
    expect(editor).not.toContain("[caretRequest, onCaretHandled, value]")
  })

  it("续写只用默认模型，不新开模型设置项", () => {
    const block = callbackBlock(previewPanelSource, "const runContinuation = useCallback(")
    expect(block).toContain("resolveDefaultModel(state.llmConfig)")
    expect(block).not.toContain("resolveNovelModel")
  })

  it("续写不读记忆 / 维基 / 其它章节，送模文本只来自正文", () => {
    const block = callbackBlock(previewPanelSource, "const runContinuation = useCallback(")
    expect(block).toContain("buildContinuationMessages(anchor.bodySnapshot, continuationInstruction)")
    expect(block).not.toContain("buildContextHub")
    expect(block).not.toContain("memory")
  })
})

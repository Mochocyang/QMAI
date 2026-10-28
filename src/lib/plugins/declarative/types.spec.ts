/**
 * 类型契约里的运行时判定（`isRunnableTarget`）。
 *
 * 为什么值得单独测：`run-action` 是唯一"什么都不写、却能触发另一段生成/写入"的
 * target。少了 `actionId` 它就是个死按钮；指向别的插件它就成了隐式依赖。
 * 这两条一旦漏判，用户在灵感库里点到的那一下要么毫无反应，要么在卸载某个插件后
 * 静默失效 —— 都是最难查的一类问题。
 */
import { describe, expect, it } from "vitest"
import { isRunnableTarget, type OutputTarget } from "./types"

describe("isRunnableTarget", () => {
  it("带 actionId 的 run-action 才算可运行", () => {
    const target: OutputTarget = { kind: "run-action", actionId: "expand-idea", label: "让 AI 扩写" }
    expect(isRunnableTarget(target)).toBe(true)
    if (isRunnableTarget(target)) {
      // 类型守卫收窄后 actionId 是非空字符串，调用方不必再判空
      expect(target.actionId).toBe("expand-idea")
    }
  })

  it("缺 actionId（或只有空白）的 run-action 不可运行", () => {
    expect(isRunnableTarget({ kind: "run-action", label: "让 AI 扩写" })).toBe(false)
    expect(isRunnableTarget({ kind: "run-action", actionId: "   ", label: "让 AI 扩写" })).toBe(false)
  })

  it("写通道的四种 target 一律不是 run-action", () => {
    const kinds: OutputTarget[] = [
      { kind: "project-field", field: "bookTitle", label: "设为书名" },
      { kind: "insert-at-cursor", label: "插入到光标处" },
      { kind: "clipboard", label: "复制" },
      { kind: "chapter-note", label: "追加到章节备注" },
    ]
    for (const target of kinds) expect(isRunnableTarget(target)).toBe(false)
  })
})

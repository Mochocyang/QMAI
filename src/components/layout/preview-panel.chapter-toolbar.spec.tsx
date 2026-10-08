/**
 * 工具栏图标的源码守卫。
 *
 * ── 为什么是源码断言而不是渲染断言 ──
 * 一键排版按钮只在「选中章节」时才渲染，而章节工具栏的图标是
 * 一层 JSX 里的字面量。渲染断言需要把整个 PreviewPanel 的依赖
 * （项目、文件内容、章节状态、Tauri IPC）都造出来，代价远高于收益，
 * 而且它测的仍然是同一行字面量。这里直接钉住那一行。
 *
 * ── 这条守卫防的是什么 ──
 * 用户明确提出「一键排版的图标与正文字体的图标不能设置为一样」。
 * 当前两处都用 lucide 的 Type，是一模一样的图标。这条断言让
 * "改回去 / 新增按钮时又抄了 Type" 立刻变红。
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")

/**
 * 取某个 aria-label 按钮的**完整片段**（不是"那一行"）。
 *
 * 为什么必须跨行：按钮常被排成多行 ——
 *   <button … aria-label="字体设置" …>
 *     <Type aria-hidden="true" />
 *   </button>
 * 只取命中 aria-label 的那一行，<Type /> 就落在视野之外，
 * 「这个按钮用了哪个图标」的断言会**假红**：报错看着像"图标没换"，
 * 其实只是排版换行了。反过来也一样 —— 一键排版按钮若被排成多行，
 * 它的 not.toContain("<Type") 会因为同一原因假绿。
 *
 * 做法：从命中 aria-label 的那行起累加，直到该 <button> 闭合。
 */
function buttonBlock(ariaLabel: string): string {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((item) => item.includes(`aria-label="${ariaLabel}"`))
  if (start < 0) throw new Error(`找不到按钮：${ariaLabel}`)
  const collected: string[] = []
  for (let i = start; i < lines.length; i++) {
    collected.push(lines[i])
    if (lines[i].includes("</button>")) break
  }
  return collected.join("\n")
}

describe("章节与大纲工具栏图标", () => {
  it("一键排版用魔法棒图标，不再是字体图标", () => {
    const line = buttonBlock("一键排版")
    expect(line).toContain("WandSparkles")
    // 两处图标撞车正是本次要修的缺陷
    expect(line).not.toContain("<Type")
  })

  it("字体设置用 Type 图标，且与一键排版不是同一个", () => {
    const line = buttonBlock("字体设置")
    expect(line).toContain("Type")
    expect(line).not.toContain("WandSparkles")
    expect(buttonBlock("一键排版")).not.toBe(line)
  })

  it("章节与大纲都能打开字体设置浮层", () => {
    // 两处入口都调同一个打开函数（共用同一个面板，含同一份值）
    expect(source.match(/openBodyFontPopover\(event\.currentTarget\)/g)?.length).toBe(2)
  })
})

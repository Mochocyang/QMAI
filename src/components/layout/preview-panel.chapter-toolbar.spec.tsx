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
 *
 * ── occurrence 参数：为什么必须有（这是实测出来的一个真盲区）──
 * 这个函数原先用 `findIndex`，也就是**只取第一处**匹配。
 * 而「字体设置」在源码里有**两处**：章节工具栏一处、大纲工具栏一处。
 * 于是 Task 11 的变异验证发现：**只把大纲那处的图标改回 WandSparkles，
 * 全部守卫依然全绿** —— 大纲那一处从没进入任何断言的视野。
 *
 * 这正好和本次要修的缺陷同类：用户原话是「一键排版的图标与正文字体的图标
 * 两个不能设置为一样」，而"两处入口"是用户明确要求的。
 * 只守住章节那处，等于把"大纲里又抄错了图标"这类回归放走 ——
 * 而它恰恰是**用户在界面上能直接看到**的那种错。
 *
 * 所以加 occurrence（1 起算）。传 2 就取第二处。
 * 找不到第 occurrence 处时**抛错**而不是回退到第一处：
 * 静默回退会让"大纲入口被删掉"这种情况继续假绿，
 * 而那正是要防的另一件事。
 */
function buttonBlock(ariaLabel: string, occurrence = 1): string {
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error(`occurrence 必须是 1 起的整数，收到 ${occurrence}`)
  }
  const lines = source.split(/\r?\n/)
  let seen = 0
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`aria-label="${ariaLabel}"`)) {
      seen += 1
      if (seen === occurrence) {
        start = i
        break
      }
    }
  }
  if (start < 0) {
    throw new Error(`找不到第 ${occurrence} 处按钮：${ariaLabel}（共找到 ${seen} 处）`)
  }
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

  /*
   * 大纲那一处**必须单独钉**。
   *
   * 上面那条用的是第一处「字体设置」（章节工具栏）。实测变异：
   * 只把大纲那处的图标改成 WandSparkles，全部守卫**依然全绿** ——
   * 因为大纲那处从来没进入任何断言的视野（buttonBlock 原先只取第一处）。
   *
   * 而用户的要求是**两处入口**都要有、且图标都不能与一键排版撞车：
   * 「大纲当中也要有这个设置功能」。所以这一条不是重复，
   * 它守的是另一半。删掉它，大纲入口就能悄悄退化成魔法棒图标。
   */
  it("大纲的字体设置也用 Type 图标，同样不与一键排版撞车", () => {
    const outline = buttonBlock("字体设置", 2)
    expect(outline).toContain("Type")
    expect(outline).not.toContain("WandSparkles")
    /*
     * 这里**故意不加** `expect(outline).not.toBe(buttonBlock("字体设置", 1))`。
     * 我第一版加了它，结果是假红：章节与大纲那两段按钮的文本
     * **逐字节相同**（同一套 className / title / onClick / 同一个 <Type />），
     * 就像两处入口本来就该长一样。
     *
     * 而"它们是不是同一段被取到两次"这个担心，其实由 occurrence 机制本身
     * 解决了：它按**行**逐个计数，第 2 次命中必然在更靠后的行上。
     * 真正需要防的是"大纲入口被删掉"——那种情况下
     * buttonBlock("字体设置", 2) 会**抛错**（找不到第 2 处），用例照样红，
     * 而且报错信息会直接说明缺的是第几处。
     */
  })

  it("章节与大纲都能打开字体设置浮层", () => {
    // 两处入口都调同一个打开函数（共用同一个面板，含同一份值）
    expect(source.match(/openBodyFontPopover\(event\.currentTarget\)/g)?.length).toBe(2)
  })
})

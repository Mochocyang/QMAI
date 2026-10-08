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
 *
 * ── ⚠ 命中点必须锚定到 <button>（代码质量审查 I5）──
 * 原先只匹配 `aria-label="字体设置"`，于是**浮层容器**那一行
 * （`<div … role="dialog" aria-label="字体设置">`）也会命中 ——
 * 「字体设置」实际有 **3** 处命中（章节按钮 / 大纲按钮 / 浮层容器），
 * 而不是注释里说的 2 处。后果是：把大纲按钮删掉后，
 * `buttonBlock("字体设置", 2)` **不会抛错**，而是返回浮层容器那一段，
 * 用例最后因为 `toContain("Type")` 为假而红 —— 仍然会红，
 * 但报错指向"图标不对"，而真实原因是"大纲入口没了"。
 * 与注释承诺的定位能力不符，会让后来者查错方向。
 *
 * 现在要求命中行同时含有 `<button`。这样 3 处命中里只剩真正的两个按钮。
 */
function buttonBlock(ariaLabel: string, occurrence = 1): string {
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error(`occurrence 必须是 1 起的整数，收到 ${occurrence}`)
  }
  const lines = source.split(/\r?\n/)
  let seen = 0
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    /*
     * 同时要求 <button：把浮层容器（role="dialog" aria-label="字体设置"）
     * 排除在外。少了这个条件，"第 2 处"会取错东西。
     */
    if (lines[i].includes("<button") && lines[i].includes(`aria-label="${ariaLabel}"`)) {
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

/**
 * 取出片段里用到的 lucide 图标组件名（形如 `<WandSparkles ... />`）。
 *
 * 为什么需要它：用户的原话是「一键排版的图标与正文字体的图标两个不能
 * 设置为一样」—— 这是个**图标层面**的不变量。直接比较两段按钮文本
 * 是证明不了它的（下面那条注释里有详细说明），必须把图标名取出来比。
 */
function iconNamesIn(block: string): string[] {
  const names = new Set<string>()
  for (const m of block.matchAll(/<([A-Z][A-Za-z0-9]*)\s/g)) {
    /* 排除 HTML 标签与属性名；lucide 图标都是 PascalCase 且没有小写开头 */
    names.add(m[1])
  }
  return [...names]
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
    /*
     * 这里原本写的是 `expect(buttonBlock("一键排版")).not.toBe(line)`。
     * 那是一条**恒真断言**，代码质量审查 C1 发现的：
     * 两段片段是用**不同的 needle**（不同的 aria-label）定位的，
     * 所以它们的首行必然不同，字符串**永远不可能相等**。
     * 实测把它改成"一键排版也用 Type"（即用户投诉的撞车场景），
     * 那一行**照样通过** —— 它对声称保护的不变量零鉴别力，只贡献一行绿。
     *
     * 改成直接比较**图标名**：这才是用户提的那个不变量
     * （「一键排版的图标与正文字体的图标两个不能设置为一样」），
     * 而且它对撞车场景真的会红。
     */
    const fanIcon = iconNamesIn(line)
    const formatIcon = iconNamesIn(buttonBlock("一键排版"))
    expect(fanIcon, "「字体设置」应恰好用一个图标组件").toHaveLength(1)
    expect(formatIcon, "「一键排版」应恰好用一个图标组件").toHaveLength(1)
    expect(fanIcon[0], "两处图标不能是同一个组件").not.toBe(formatIcon[0])
    expect(fanIcon[0]).toBe("Type")
    expect(formatIcon[0]).toBe("WandSparkles")
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

/*
 * ── 下面这一组是「值接线」守卫，补的是审查发现的一个真缺口 ──
 *
 * 浮层里的 6 个控件共用正文一套值。这些值有三处"手抄"：
 *   ① `value={{ fontPx: uiBodyFontPx, … }}`   —— 读
 *   ② `case "fontPx": setUiBodyFontPx(…)`      —— 写
 *   ③ `saveUiBodyFontPx(s.uiBodyFontPx)`       —— 落盘
 * 三处都容易"串味"（把 lineHeight 接成 safeBottom）。
 *
 * 为什么现有守卫一条都抓不住：**6 个值全是 number**（fontFamily 除外），
 * 所以串味之后 tsc 照样过、case 都在、`= key` 穷尽收尾也照样过。
 * 审查实测了 6 个变异（读串味、写串味、落盘串味、漏一个落盘、漏一个 case、
 * 以及漏一个 case 导致的错配），全部**保持绿**。而它们的用户可见后果是：
 *   · 拖「行间距」结果「字号」动了（读串味）
 *   · 改「行间距」实际改的是「字间距」（写串味）
 *   · 某个设置**永远存不下去**，重开软件就回退（漏落盘）
 * 都是"设置莫名其妙"那种很难归因的毛病。
 *
 * 本仓库已有先例：App.tsx 那份同样的映射**是有配对守卫的**
 * （interface-sidebar-nav.spec.ts 的 APPLIED 数组）。Task 11 在
 * preview-panel.tsx 里新增的是**第三份**拷贝，当时没配上守卫 ——
 * 这里补上，与那份对齐。
 */
describe("字体设置浮层的值接线（三处手抄必须各自配对）", () => {
  /*
   * 取 `applyBodyTypographyChange` 里那个 switch 的**每个 case 的完整 case 体**。
   *
   * ── 为什么不能用"逐行找 `case "X":` 独占一行 + 取其后第一条语句" ──
   * 那个版本有**两个**实测出来的毛病（代码质量审查 I2、I3）：
   *
   * I2「格式耦合 → 假红」：它要求 `case "X":` 独占一行。
   *   把 switch 改写成同样合法的单行形式
   *       case "fontPx": setUiBodyFontPx(next as number); break
   *   或块体形式
   *       case "fontPx": { … }
   *   实测会**抛错「找不到 case "fontPx"」** —— 语义等价的重排让守卫假红。
   *   而假红的代价是让人去放宽断言（本仓库明确记录过这个坑）。
   *
   * I3「只看第一条语句 → 漏判」：保留正确的 setter 之后再补一行
   *   错误的 setter（两种串味同时发生），实测**守卫全绿**。
   *   用户可见后果与单纯串味一样。
   *
   * 现在改成：先把整个 case 体切出来（允许同行写法），再在**整段体**上断言
   * 「应当调用的那个 setter 在」且「任何**别的** setUiBody* setter 都不在」。
   * 这样既不怕重排，也抓得住多写的那一行。
   */
  function caseBodies(): Map<string, string> {
    const src = source.replace(/\r\n/g, "\n")

    /* 定位到 applyBodyTypographyChange 里的 switch，避免撞上别的 switch */
    const fnIdx = src.indexOf("const applyBodyTypographyChange")
    if (fnIdx < 0) throw new Error("找不到 applyBodyTypographyChange")
    const switchIdx = src.indexOf("switch (key) {", fnIdx)
    if (switchIdx < 0) throw new Error("applyBodyTypographyChange 里找不到 switch (key) {")

    /* 花括号配平找 switch 的收尾 */
    const open = src.indexOf("{", switchIdx)
    let depth = 0
    let close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth += 1
      else if (src[i] === "}") {
        depth -= 1
        if (depth === 0) { close = i; break }
      }
    }
    if (close < 0) throw new Error("switch 的花括号没配平")
    const body = src.slice(open + 1, close)

    /*
     * 按 `case "X":` 切段。允许 case 与语句同行、也允许块体 ——
     * 只要求 `case "X":` 后面紧跟可选空白。
     */
    const result = new Map<string, string>()
    const re = /case\s+"([A-Za-z0-9_]+)"\s*:/g
    const marks: Array<{ name: string; at: number }> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) marks.push({ name: m[1], at: m.index })
    if (marks.length === 0) throw new Error("一个 case 都没找到 —— 守卫的定位逻辑可能失效了")
    for (let i = 0; i < marks.length; i++) {
      const from = marks[i].at
      const to = i + 1 < marks.length ? marks[i + 1].at : body.length
      result.set(marks[i].name, body.slice(from, to))
    }
    return result
  }

  it("switch 的每个 case 各自调用同名的 setter（且不夹带别的 setter）", () => {
    const bodies = caseBodies()
    const ALL_SETTERS = [
      "setUiBodyFontFamily",
      "setUiBodyFontPx",
      "setUiBodyLineHeight",
      "setUiBodyLetterSpacing",
      "setUiBodyMarginX",
      "setUiBodySafeBottom",
    ] as const

    for (const [key, setter] of [
      ["fontFamily", "setUiBodyFontFamily"],
      ["fontPx", "setUiBodyFontPx"],
      ["lineHeight", "setUiBodyLineHeight"],
      ["letterSpacing", "setUiBodyLetterSpacing"],
      ["marginX", "setUiBodyMarginX"],
      ["safeBottom", "setUiBodySafeBottom"],
    ] as const) {
      const b = bodies.get(key)
      expect(b, `switch 里应有 case "${key}"`).toBeDefined()
      /*
       * ① 应当调用的那个 setter 必须在（并核对它收到的是 next，
       *    而不是某个写死的常量 —— 那也是一种"看着对其实错"）。
       */
      expect(b!, `${key} 的 case 体应调用 ${setter}(next…)`).toContain(`${setter}(next`)
      /*
       * ② **任何别的** setUiBody* setter 都不许出现在这同一段体里。
       *    这一条是 I3 的修复：保留正确语句再补一行串味，现在会红。
       */
      for (const other of ALL_SETTERS) {
        if (other === setter) continue
        expect(
          b!.includes(other),
          `${key} 的 case 体里不该出现 ${other}（串味会让那一半设置被写错）`,
        ).toBe(false)
      }
    }
  })

  it("value 对象的 6 个字段各自对着正确的 store 字段", () => {
    // 串味之后这里必须红：值都是 number，tsc 拦不住
    for (const [field, storeField] of [
      ["fontPx", "uiBodyFontPx"],
      ["lineHeight", "uiBodyLineHeight"],
      ["letterSpacing", "uiBodyLetterSpacing"],
      ["marginX", "uiBodyMarginX"],
      ["safeBottom", "uiBodySafeBottom"],
    ] as const) {
      expect(source).toContain(`${field}: ${storeField}`)
    }
    expect(source).toContain("fontFamily: uiBodyFontFamily")
  })

  it("落盘时每个字段各自读同名的 store 字段", () => {
    /*
     * 「读回来了却忘了写回」是本仓库记录过的、最难发现的一类
     * （编译过、界面不报错、只有"重开软件设置回退"一个症状）。
     * 这里连"读哪个字段"一起钉住：把 saveUiBodyLineHeight(s.uiBodyFontPx)
     * 写错、或整行删掉，都必须红。
     */
    for (const [saver, storeField] of [
      ["saveUiBodyFontFamily", "s.uiBodyFontFamily"],
      ["saveUiBodyFontPx", "s.uiBodyFontPx"],
      ["saveUiBodyLineHeight", "s.uiBodyLineHeight"],
      ["saveUiBodyLetterSpacing", "s.uiBodyLetterSpacing"],
      ["saveUiBodyMarginX", "s.uiBodyMarginX"],
      ["saveUiBodySafeBottom", "s.uiBodySafeBottom"],
    ] as const) {
      expect(source).toContain(`${saver}(${storeField})`)
    }
  })
})

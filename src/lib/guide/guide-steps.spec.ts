import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  GUIDE_ANCHORS,
  GUIDE_CHAPTERS,
  GUIDE_STEPS,
  getChapterStartIndex,
  getGuideStepIndex,
} from "./guide-steps"
import { GUIDE_DEMO_NOVELS, buildGuideDemoOutlineMarkdown, pickGuideDemoNovel } from "./guide-demo-novel"
import type { GuideStep } from "./guide-types"

/** 一步用到的全部锚点：`anchors` 候选在前，单值 `anchor` 兜底，顺序即优先级。 */
function stepAnchors(step: GuideStep): string[] {
  return [...(step.anchors ?? []), ...(step.anchor ? [step.anchor] : [])]
}

/**
 * 引导步骤链的结构不变量。
 *
 * 这里**不测文案**（文案是产品决定，改一次就断言一次只会锁死表达），只测
 * 「结构上必然会让用户卡住」的那几类问题：
 *   · 步骤 id 重复 → store 按 index 走，重复 id 会让「从这步开始」跳错位置；
 *   · 阶段顺序倒着走 → 引导会把用户从设置踢回书架再踢回设置；
 *   · 锚点写了但界面里没有 → 该步永远显示「正在等待界面」，用户只能跳过；
 *   · 界面里有锚点但步骤没用 → 改名后漏改数据的信号；
 *   · 阶段第一步没有 `chapterBreak` → 用户无法整段跳过，只能一步步点完。
 */

const COMPONENTS_ROOT = join(process.cwd(), "src", "components")

function collectTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectTsxFiles(full, out)
    } else if (entry.endsWith(".tsx") && !entry.includes(".spec.") && !entry.includes(".test.")) {
      out.push(full)
    }
  }
  return out
}

/** 组件源码里真实声明的 `data-guide` 锚点（含模板字符串前缀）。 */
function collectDeclaredAnchors(): { literal: Set<string>; templatePrefixes: string[] } {
  const literal = new Set<string>()
  const templatePrefixes: string[] = []
  for (const file of collectTsxFiles(COMPONENTS_ROOT)) {
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(/data-guide="([^"]+)"/g)) {
      literal.add(match[1])
    }
    /*
     * 动态锚点两种写法都要认：
     *   data-guide={`settings.model-tab.${tab.id}`}   → 前缀匹配
     *   data-guide={item.view === "wiki" ? "shell.nav.wiki" : undefined} → 取三元里的字面量
     * 只认模板字符串会漏掉第二种，报一个假失败（本轮踩过）。
     */
    for (const match of source.matchAll(/data-guide=\{([^}\n]*)\}/g)) {
      const expression = match[1]
      for (const inner of expression.matchAll(/"([^"]+)"/g)) literal.add(inner[1])
      for (const inner of expression.matchAll(/`([^`$]+)\$\{/g)) templatePrefixes.push(inner[1])
    }
  }
  return { literal, templatePrefixes }
}

describe("引导步骤链", () => {
  it("步骤 id 唯一", () => {
    const ids = GUIDE_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("每一步都挂在一个已声明的阶段上", () => {
    const chapterIds = new Set(GUIDE_CHAPTERS.map((chapter) => chapter.id))
    for (const step of GUIDE_STEPS) {
      expect(chapterIds.has(step.chapter), `${step.id} 指向了不存在的阶段 ${step.chapter}`).toBe(true)
    }
  })

  it("阶段按声明顺序单向推进，不会回头", () => {
    const order = new Map(GUIDE_CHAPTERS.map((chapter, index) => [chapter.id, index]))
    let lastChapterOrder = -1
    for (const step of GUIDE_STEPS) {
      const current = order.get(step.chapter) ?? -1
      expect(current, `${step.id} 让阶段顺序倒退了`).toBeGreaterThanOrEqual(lastChapterOrder)
      lastChapterOrder = current
    }
  })

  it("每个阶段都能通过 getChapterStartIndex 落到它的第一步", () => {
    for (const chapter of GUIDE_CHAPTERS) {
      const index = getChapterStartIndex(chapter.id)
      expect(index, `${chapter.id} 没有任何步骤`).toBeGreaterThanOrEqual(0)
      expect(GUIDE_STEPS[index].chapter).toBe(chapter.id)
    }
  })

  it("每个阶段的第一步都允许整段跳过", () => {
    for (const chapter of GUIDE_CHAPTERS) {
      const index = getChapterStartIndex(chapter.id)
      expect(GUIDE_STEPS[index].chapterBreak, `${chapter.id} 的第一步没有 chapterBreak`).toBe(true)
    }
  })

  it("步骤里引用的锚点都在 GUIDE_ANCHORS 清单里", () => {
    const declared = new Set<string>(GUIDE_ANCHORS)
    for (const step of GUIDE_STEPS) {
      for (const anchor of stepAnchors(step)) {
        expect(declared.has(anchor), `${step.id} 用了未登记的锚点 ${anchor}`).toBe(true)
      }
      for (const anchor of step.advanceOn ?? []) {
        expect(declared.has(anchor), `${step.id} 的 advanceOn 用了未登记的锚点 ${anchor}`).toBe(true)
      }
    }
  })

  it("GUIDE_ANCHORS 里的每个锚点都至少被一步使用", () => {
    const used = new Set(GUIDE_STEPS.flatMap(stepAnchors))
    for (const anchor of GUIDE_ANCHORS) {
      expect(used.has(anchor), `锚点 ${anchor} 没有任何步骤使用`).toBe(true)
    }
  })

  it("每个锚点都在组件源码里真实声明（否则该步永远等不到界面）", () => {
    const { literal, templatePrefixes } = collectDeclaredAnchors()
    for (const anchor of GUIDE_ANCHORS) {
      const dynamic = templatePrefixes.some((prefix) => anchor.startsWith(prefix))
      expect(literal.has(anchor) || dynamic, `组件里找不到 data-guide="${anchor}"`).toBe(true)
    }
  })

  it("第一步要求用户亲手点顶栏设置", () => {
    const first = GUIDE_STEPS[0]
    expect(first.anchor).toBe("shell.settings")
    expect(first.requireClick).toBe(true)
  })

  it("getGuideStepIndex 对未知步骤返回 -1（store 不会跳错位置）", () => {
    expect(getGuideStepIndex("不存在的步骤")).toBe(-1)
    expect(getGuideStepIndex(GUIDE_STEPS[3].id)).toBe(3)
  })

  /**
   * 章节工具栏那五枚按钮由 `isSelectedChapter` 控制渲染：编辑器里没有打开
   * 任何章节时它们根本不在 DOM 里。所以「载入示例章节」必须排在这些步骤之前，
   * 否则用户走到这里只会看到「正在等待界面就绪」，五步全部空转。
   */
  it("章节工具栏相关的锚点都排在「载入示例章节」之后", () => {
    const loaderIndex = GUIDE_STEPS.findIndex((step) => step.directive === "load-demo-chapter")
    expect(loaderIndex, "没有任何步骤负责载入示例章节").toBeGreaterThanOrEqual(0)
    const chapterToolbarAnchors = new Set([
      "chapter.toolbar",
      "chapter.deai",
      "chapter.memory",
      "chapter.view-memory",
      "chapter.font",
      "chapter.event-outline",
    ])
    GUIDE_STEPS.forEach((step, index) => {
      const hit = stepAnchors(step).some((anchor) => chapterToolbarAnchors.has(anchor))
      if (!hit) return
      expect(index, `${step.id} 早于示例章节载入，锚点不会存在`).toBeGreaterThanOrEqual(loaderIndex)
    })
  })

  /**
   * 内容完整性：用户点名要求的每一项都要在引导里有交代。
   * 这里只查"有没有出现过"，文案怎么写在别处不锁死。
   */
  it("用户点名要求的内容都在步骤里出现过", () => {
    const corpus = JSON.stringify(GUIDE_STEPS)
    const required = [
      "上下文窗口", "输出上限", "API Key", "拉取模型", "测试模型",
      "重排模型", "向量模型", "默认模型",
      "快速", "标准", "计划", "共创", "严格",
      "去 AI 味", "提取记忆", "查看记忆", "字体设置", "生成章节细纲",
      "文风", "章节引用",
      "灵魂", "技能库", "拆书库",
      "人物小传", "保存", "复制",
    ]
    for (const term of required) {
      expect(corpus.includes(term), `引导里没有提到「${term}」`).toBe(true)
    }
  })
})

describe("内置示例小说", () => {
  it("随机取书不会越界，且返回清单里的对象", () => {
    expect(pickGuideDemoNovel(() => 0)).toBe(GUIDE_DEMO_NOVELS[0])
    expect(pickGuideDemoNovel(() => 0.999999)).toBe(GUIDE_DEMO_NOVELS[GUIDE_DEMO_NOVELS.length - 1])
    // random() 边界返回 1 时不能取到 undefined。
    expect(pickGuideDemoNovel(() => 1)).toBe(GUIDE_DEMO_NOVELS[GUIDE_DEMO_NOVELS.length - 1])
    expect(pickGuideDemoNovel(() => -1)).toBe(GUIDE_DEMO_NOVELS[0])
  })

  it("示例大纲含「卷纲」标记，保存时能被分类成卷纲而不是普通大纲", () => {
    for (const novel of GUIDE_DEMO_NOVELS) {
      const markdown = buildGuideDemoOutlineMarkdown(novel)
      expect(markdown).toContain(`《${novel.name}》全书卷纲`)
      expect(markdown.startsWith("# ")).toBe(true)
    }
  })

  it("示例大纲不含会破坏 Markdown 的结构（连续三个空行 / 未闭合围栏）", () => {
    for (const novel of GUIDE_DEMO_NOVELS) {
      const markdown = buildGuideDemoOutlineMarkdown(novel)
      expect(/\n{4,}/.test(markdown), `${novel.name} 出现了三连空行`).toBe(false)
      expect((markdown.match(/```/g) ?? []).length % 2).toBe(0)
    }
  })
})

// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  extractChapterPlan,
  buildPlanConfirmMessage,
  buildPlanSkipMessage,
  CHAPTER_PLAN_MARKER_START,
  CHAPTER_PLAN_MARKER_END,
  ChapterPlanConfirmDialog,
} from "./chapter-plan-confirm-dialog"

// React 19 需要 IS_REACT_ACT_ENVIRONMENT 才能让 act(...) 正常工作且无警告
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("chapter-plan-confirm-dialog 纯函数", () => {
  describe("extractChapterPlan", () => {
    it("无标记时返回 null", () => {
      expect(extractChapterPlan("普通正文")).toBeNull()
    })

    it("只有开始标记时返回 null", () => {
      expect(extractChapterPlan(`${CHAPTER_PLAN_MARKER_START}计划内容`)).toBeNull()
    })

    it("完整标记时正确提取计划", () => {
      const content = `前文${CHAPTER_PLAN_MARKER_START}这是计划${CHAPTER_PLAN_MARKER_END}后文`
      const result = extractChapterPlan(content)
      expect(result).not.toBeNull()
      expect(result!.plan).toBe("这是计划")
      expect(result!.body).toBe("前文\n后文")
    })

    it("标记前后无额外内容时 body 为空字符串", () => {
      const content = `${CHAPTER_PLAN_MARKER_START}计划${CHAPTER_PLAN_MARKER_END}`
      const result = extractChapterPlan(content)
      expect(result!.plan).toBe("计划")
      expect(result!.body).toBe("")
    })

    it("计划内容含换行和空白时保留原样（仅首尾 trim）", () => {
      const content = `${CHAPTER_PLAN_MARKER_START}  第一行\n第二行  ${CHAPTER_PLAN_MARKER_END}`
      const result = extractChapterPlan(content)
      expect(result!.plan).toBe("第一行\n第二行")
    })
  })

  describe("buildPlanConfirmMessage", () => {
    it("包含已确认计划标识", () => {
      const msg = buildPlanConfirmMessage("我的计划")
      expect(msg).toContain("已确认")
      expect(msg).toContain("我的计划")
    })

    it("指示不要再次输出计划", () => {
      const msg = buildPlanConfirmMessage("计划")
      expect(msg).toContain("不要再次输出计划")
    })
  })

  describe("buildPlanSkipMessage", () => {
    it("指示直接写正文", () => {
      const msg = buildPlanSkipMessage()
      expect(msg).toContain("直接写正文")
      expect(msg).toContain("不要输出计划")
    })
  })
})

describe("ChapterPlanConfirmDialog 组件", () => {
  const baseProps = {
    open: true,
    planContent: "本章目标：主角发现秘密\n核心冲突：与反派对峙",
    aiWorkflowMode: "standard" as const,
    onConfirm: () => {},
    onSkip: () => {},
    onCancel: () => {},
  }

  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  // 模拟 @testing-library/screen.getByText 的精确匹配语义：
  // 只匹配元素自身的“直接文本节点”（忽略子元素聚合的 textContent），
  // 避免父容器因仅含一个文本子元素而被误匹配。
  function queryByText(text: string): HTMLElement | null {
    const els = Array.from(host.querySelectorAll("*")) as HTMLElement[]
    return (
      els.find((el) => {
        const directText = Array.from(el.childNodes)
          .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .replace(/\s+/g, " ")
          .trim()
        return directText === text
      }) ?? null
    )
  }

  it("open=false 时不渲染", async () => {
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} open={false} />)
    })
    expect(host.firstChild).toBeNull()
  })

  it("open=true 时显示计划内容和按钮", async () => {
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} />)
    })
    expect(queryByText("章节创作计划")).not.toBeNull()
    expect(host.textContent).toContain("本章目标：主角发现秘密")
    expect(queryByText("确认，按此计划写正文")).not.toBeNull()
    expect(queryByText("跳过计划，直接写")).not.toBeNull()
    expect(queryByText("取消生成")).not.toBeNull()
  })

  it("点击确认按钮触发 onConfirm", async () => {
    const onConfirm = vi.fn()
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} onConfirm={onConfirm} />)
    })
    const btn = queryByText("确认，按此计划写正文") as HTMLButtonElement
    await act(async () => {
      btn.click()
    })
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("点击跳过按钮触发 onSkip", async () => {
    const onSkip = vi.fn()
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} onSkip={onSkip} />)
    })
    const btn = queryByText("跳过计划，直接写") as HTMLButtonElement
    await act(async () => {
      btn.click()
    })
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it("点击取消按钮触发 onCancel", async () => {
    const onCancel = vi.fn()
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} onCancel={onCancel} />)
    })
    const btn = queryByText("取消生成") as HTMLButtonElement
    await act(async () => {
      btn.click()
    })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("提供 onModify 时显示修改计划按钮", async () => {
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} onModify={() => {}} />)
    })
    expect(queryByText("修改计划")).not.toBeNull()
  })

  it("未提供 onModify 时不显示修改计划按钮", async () => {
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} />)
    })
    expect(queryByText("修改计划")).toBeNull()
  })

  it("严格模式显示严格模式标识", async () => {
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} aiWorkflowMode="strict" />)
    })
    expect(host.textContent).toContain("严格模式")
  })
})

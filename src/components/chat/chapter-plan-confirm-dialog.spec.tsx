// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  extractChapterPlan,
  buildChapterPlanSelfCheckPrompt,
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

    it("无标记但包含章节计划结构时提取整段计划", () => {
      const content = [
        "1. 本章目标",
        "承接上一章结尾，推进女主对林风的认知变化。",
        "2. 已知依据",
        "上一章结尾：女主误认轻薄，要求林风杀她。",
        "3. 执行边界",
        "- 必须执行：林风压住杀意，局面转向对峙。",
        "4. 分场景执行计划",
        "S1：林地对峙。目的：延续误会。冲突：女主求死，林风拒绝。",
        "5. 信息流与伏笔",
        "本章揭示女主对林风身份的误判。",
        "6. 验收标准",
        "- 女主仍然误解林风。",
        "7. 风险与兜底",
        "- 避免直接写成解释说明。",
      ].join("\n")

      const result = extractChapterPlan(content)

      expect(result).not.toBeNull()
      expect(result!.plan).toBe(content)
      expect(result!.body).toBe("")
    })

    it("只有少量计划词但不是结构化计划时仍返回 null", () => {
      expect(extractChapterPlan("本章目标是制造紧张感，然后直接输出正文。")).toBeNull()
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
      expect(msg).toContain("已确认的章节计划")
      expect(msg).not.toContain("蓝图")
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

  describe("buildChapterPlanSelfCheckPrompt", () => {
    it("要求检查计划完整性并包含计划原文", () => {
      const prompt = buildChapterPlanSelfCheckPrompt("维度四·场景序列编排：旧屋揭示")

      expect(prompt).toContain("计划自检")
      expect(prompt).not.toContain("蓝图")
      expect(prompt).not.toContain("七个维度")
      for (const section of [
        "本章目标",
        "已知依据",
        "执行边界",
        "分场景执行计划",
        "信息流与伏笔",
        "验收标准",
        "风险与兜底",
      ]) {
        expect(prompt).toContain(section)
      }
      expect(prompt).toContain("目的、冲突、转折、输出结果、验收标准")
      expect(prompt).toContain("缺失段落、缺失场景字段或不可验收的标准必须进入 issues")
      expect(prompt).toContain("维度四·场景序列编排：旧屋揭示")
      expect(prompt).toContain("只输出一个 JSON 对象")
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

  it("提供 onSelfCheck 时显示自检按钮", async () => {
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} onSelfCheck={async () => "自检通过"} />)
    })
    expect(queryByText("自检计划")).not.toBeNull()
  })

  it("点击自检按钮后显示自检结果", async () => {
    const onSelfCheck = vi.fn(async () => "自检结果：场景序列完整，但缺少字数预算。")
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} onSelfCheck={onSelfCheck} />)
    })
    const btn = queryByText("自检计划") as HTMLButtonElement
    await act(async () => {
      btn.click()
    })

    expect(onSelfCheck).toHaveBeenCalledOnce()
    expect(host.textContent).toContain("自检结果：场景序列完整，但缺少字数预算。")
  })

  it("自检后可按建议修正计划并进入编辑状态", async () => {
    const onSelfCheck = vi.fn(async () => "状态：warning\n建议：补充篇幅分配")
    const onRevisePlan = vi.fn(async () => "修订后计划：已补充篇幅分配")
    await act(async () => {
      root.render(
        <ChapterPlanConfirmDialog
          {...baseProps}
          onSelfCheck={onSelfCheck}
          onRevisePlan={onRevisePlan}
        />,
      )
    })
    const selfCheckBtn = queryByText("自检计划") as HTMLButtonElement
    await act(async () => {
      selfCheckBtn.click()
    })
    const reviseBtn = queryByText("按自检建议修正") as HTMLButtonElement
    await act(async () => {
      reviseBtn.click()
    })

    expect(onRevisePlan).toHaveBeenCalledWith(
      baseProps.planContent,
      "状态：warning\n建议：补充篇幅分配",
    )
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(textarea.value).toBe("修订后计划：已补充篇幅分配")
  })

  it("修订计划后点击普通确认也按修订后的计划执行", async () => {
    const onConfirm = vi.fn()
    const onModify = vi.fn()
    const onSelfCheck = vi.fn(async () => "状态：warning\n建议：补充篇幅分配")
    const onRevisePlan = vi.fn(async () => "修订后计划：已补充篇幅分配")
    await act(async () => {
      root.render(
        <ChapterPlanConfirmDialog
          {...baseProps}
          onConfirm={onConfirm}
          onModify={onModify}
          onSelfCheck={onSelfCheck}
          onRevisePlan={onRevisePlan}
        />,
      )
    })
    await act(async () => {
      ;(queryByText("自检计划") as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(queryByText("按自检建议修正") as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(queryByText("确认，按此计划写正文") as HTMLButtonElement).click()
    })

    expect(onModify).toHaveBeenCalledWith("修订后计划：已补充篇幅分配")
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("自检期间关闭弹窗后不会把旧结果带到下次打开", async () => {
    let resolveSelfCheck!: (value: string) => void
    const onSelfCheck = vi.fn(() => new Promise<string>((resolve) => {
      resolveSelfCheck = resolve
    }))
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} onSelfCheck={onSelfCheck} />)
    })
    const btn = queryByText("自检计划") as HTMLButtonElement
    await act(async () => {
      btn.click()
    })
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} open={false} onSelfCheck={onSelfCheck} />)
    })
    await act(async () => {
      resolveSelfCheck("旧的自检结果")
    })
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} open={true} onSelfCheck={onSelfCheck} />)
    })

    expect(host.textContent).not.toContain("旧的自检结果")
  })

  it("严格模式显示严格模式标识", async () => {
    await act(async () => {
      root.render(<ChapterPlanConfirmDialog {...baseProps} aiWorkflowMode="strict" />)
    })
    expect(host.textContent).toContain("严格模式")
  })
})

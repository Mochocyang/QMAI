import { describe, expect, it } from "vitest"
import {
  CONTINUE_STOPPED_GENERATION_PROMPT,
  hasStoppedGenerationContent,
  isStoppedGenerationMessage,
  stoppedGenerationContent,
} from "./stopped-generation"

describe("isStoppedGenerationMessage", () => {
  it("认得出章节面板的停止标记（正文 + 已停止生成。）", () => {
    expect(isStoppedGenerationMessage("他推开门，风雪灌了进来。\n\n已停止生成。")).toBe(true)
  })

  it("认得出章节面板「一个字都没生成」的停止标记", () => {
    expect(isStoppedGenerationMessage("已停止生成。")).toBe(true)
  })

  it("认得出大纲面板的停止标记（带分隔线与警告）", () => {
    expect(isStoppedGenerationMessage("## 主线\n主角踏上旅途。\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。")).toBe(true)
  })

  it("正常完成的消息不算停止", () => {
    expect(isStoppedGenerationMessage("## 主线\n主角踏上旅途。")).toBe(false)
  })

  it("空内容与空值都不算停止", () => {
    expect(isStoppedGenerationMessage("")).toBe(false)
    expect(isStoppedGenerationMessage(undefined)).toBe(false)
    expect(isStoppedGenerationMessage(null)).toBe(false)
  })

  /**
   * 停止标记是**收尾追加**的。模型自己在正文里写出"已停止生成"这几个字
   * （比如它在解释一段设定）时，这条消息其实是一个正常完成的回复，
   * 不能因为中间的巧合字句就长出两个按钮。
   */
  it("标记只认结尾：正文中间出现同样字句不算停止", () => {
    expect(isStoppedGenerationMessage("已停止生成。后面还有正常内容。")).toBe(false)
    expect(isStoppedGenerationMessage("⚠️ 生成已停止，以上为已生成的内容。\n\n补充说明一段。")).toBe(false)
  })

  it("用户消息里引用了这句话也不受影响（判定只看正文结尾）", () => {
    expect(isStoppedGenerationMessage("请解释一下「已停止生成。」这句话的含义")).toBe(false)
  })
})

describe("stoppedGenerationContent", () => {
  it("剥掉章节侧标记，只留已生成正文", () => {
    expect(stoppedGenerationContent("他推开门，风雪灌了进来。\n\n已停止生成。"))
      .toBe("他推开门，风雪灌了进来。")
  })

  it("剥掉大纲侧长标记，连分隔线与警告一起剥干净", () => {
    expect(stoppedGenerationContent("## 主线\n主角踏上旅途。\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。"))
      .toBe("## 主线\n主角踏上旅途。")
  })

  /**
   * 长短标记都含 "已停止生成" 子串：若短的先匹配，大纲侧剥完会剩下
   * `---\n\n⚠️` 这种垃圾尾巴。这条用例把这个顺序钉住。
   */
  it("长标记优先，剥离后不留分隔线或警告残渣", () => {
    const stripped = stoppedGenerationContent("正文。\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。")
    expect(stripped).toBe("正文。")
    expect(stripped).not.toContain("---")
    expect(stripped).not.toContain("⚠️")
  })

  it("一个字都没生成时剥出来是空串", () => {
    expect(stoppedGenerationContent("已停止生成。")).toBe("")
  })

  it("不是停止消息时原样返回", () => {
    expect(stoppedGenerationContent("正常内容。")).toBe("正常内容。")
  })
})

describe("hasStoppedGenerationContent", () => {
  it("有已生成正文时为真", () => {
    expect(hasStoppedGenerationContent("正文一段。\n\n已停止生成。")).toBe(true)
  })

  it("只有空白时为假", () => {
    expect(hasStoppedGenerationContent("已停止生成。")).toBe(false)
    expect(hasStoppedGenerationContent("   \n\n已停止生成。")).toBe(false)
  })
})

describe("CONTINUE_STOPPED_GENERATION_PROMPT", () => {
  /*
   * 「继续」不是"重发上一条请求"（那是「重试」），而是让模型接着往下写。
   * 提示词必须把这两点说清楚，否则模型会从头重写一遍，用户看到的就是重复内容。
   */
  it("要求接着写，并要求不要重复已生成内容", () => {
    expect(CONTINUE_STOPPED_GENERATION_PROMPT).toContain("继续")
    expect(CONTINUE_STOPPED_GENERATION_PROMPT).toContain("不要重复")
  })
})

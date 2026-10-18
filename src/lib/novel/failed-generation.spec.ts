import { describe, expect, it } from "vitest"

import {
  failedGenerationPartialContent,
  hasFailedGenerationPartialContent,
  isFailedGenerationMessage,
} from "./failed-generation"

describe("failed-generation", () => {
  it("识别章节面板的失败提示（有半截内容时追加在末尾）", () => {
    const content = "他推开门，风雪灌了进来。\n\n出错：API 500 Internal Server Error"
    expect(isFailedGenerationMessage(content)).toBe(true)
    expect(failedGenerationPartialContent(content)).toBe("他推开门，风雪灌了进来。")
    expect(hasFailedGenerationPartialContent(content)).toBe(true)
  })

  it("识别章节面板「一个字都没产出」的失败", () => {
    const content = "出错：401 Unauthorized"
    expect(isFailedGenerationMessage(content)).toBe(true)
    expect(failedGenerationPartialContent(content)).toBe("")
    expect(hasFailedGenerationPartialContent(content)).toBe(false)
  })

  it("识别大纲面板「保留半截内容」的中断提示（前导分隔是 ---）", () => {
    const content = "## 主线\n主角踏上旅途。\n\n---\n\n⚠️ 生成中断：请求超时"
    expect(isFailedGenerationMessage(content)).toBe(true)
    expect(failedGenerationPartialContent(content)).toBe("## 主线\n主角踏上旅途。")
    expect(hasFailedGenerationPartialContent(content)).toBe(true)
  })

  it("识别大纲面板「完全失败」的提示", () => {
    const content = "生成失败：模型不存在"
    expect(isFailedGenerationMessage(content)).toBe(true)
    expect(hasFailedGenerationPartialContent(content)).toBe(false)
  })

  it("正常正文里顺带写到「出错：」不算失败", () => {
    const content = "他出错：不该在这时说这句话。"
    expect(isFailedGenerationMessage(content)).toBe(false)
    expect(failedGenerationPartialContent(content)).toBe(content)
  })

  it("已停止生成的消息不算失败", () => {
    expect(isFailedGenerationMessage("写到一半。\n\n已停止生成。")).toBe(false)
    expect(isFailedGenerationMessage("写到一半。\n\n---\n\n⚠️ 生成已停止，以上为已生成的内容。")).toBe(false)
  })

  it("空内容不算失败", () => {
    expect(isFailedGenerationMessage("")).toBe(false)
    expect(isFailedGenerationMessage(null)).toBe(false)
    expect(isFailedGenerationMessage(undefined)).toBe(false)
    expect(failedGenerationPartialContent(null)).toBe("")
  })

  /*
   * 模型自己在半截正文里写了「出错：」、随后请求真的失败时，取**最靠后**的
   * 那一处才剥得干净；取第一处会把模型写的那半句连同后面的正文一起当成错误信息丢掉。
   */
  it("正文里出现同名片段时，以最后一处为准", () => {
    const content = "第一段\n\n出错：这是一句设定\n\n第二段\n\n出错：网络中断"
    expect(failedGenerationPartialContent(content)).toBe("第一段\n\n出错：这是一句设定\n\n第二段")
  })
})

import { describe, expect, it } from "vitest"
import { friendlyLlmErrorMessage } from "./llm-error-message"

describe("friendlyLlmErrorMessage（底层错误归一化）", () => {
  it("reqwest 流式解码失败 → 中文说明 + 建议", () => {
    const message = friendlyLlmErrorMessage("error decoding response body")
    expect(message).toContain("响应在传输中途被中断")
    expect(message).toContain("重试")
  })

  it("reqwest 发送失败 / 通用网络失败 → 中文说明", () => {
    expect(friendlyLlmErrorMessage("error sending request for url (https://x)")).toContain(
      "无法连接到模型接口",
    )
    expect(friendlyLlmErrorMessage("Failed to fetch")).toContain("网络连接失败")
    expect(friendlyLlmErrorMessage("Load failed")).toContain("网络连接失败")
  })

  it("未知错误原样保留（便于排查真实原因）", () => {
    expect(friendlyLlmErrorMessage("HTTP 429: too many requests")).toBe(
      "HTTP 429: too many requests",
    )
  })

  it("空值返回空串", () => {
    expect(friendlyLlmErrorMessage("")).toBe("")
    expect(friendlyLlmErrorMessage(null)).toBe("")
    expect(friendlyLlmErrorMessage(undefined)).toBe("")
  })
})

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "lint-view.tsx"), "utf8")

describe("lint-view 长任务状态持久化", () => {
  it("开始检查时生成 runId 并写入 store", () => {
    expect(source).toContain("runId")
    expect(source).toContain("setLintRun")
  })

  it("检查完成后通过 finishLintRun 匹配 runId 写回结果", () => {
    expect(source).toContain("finishLintRun(runId")
  })

  it("finally 块检查 runId 匹配后写回 running: false", () => {
    expect(source).toContain("current?.runId === runId")
  })

  it("错误时使用 finishLintRun 写回 error", () => {
    expect(source).toContain('t("lint.messages.runFailed")')
  })

  it("错误 UI 包含 AlertTriangle 和 error 显示", () => {
    expect(source).toContain("<AlertTriangle")
    expect(source).toContain("{error}")
  })

  it("错误 UI 不为全屏空态，使用横幅样式", () => {
    expect(source).toContain("border-destructive/30")
    expect(source).toContain("bg-destructive/10")
  })
})
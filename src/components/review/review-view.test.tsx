import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "review-view.tsx"), "utf8")

describe("review-view 长任务状态持久化", () => {
  it("开始审稿时生成 runId 并写入 store", () => {
    expect(source).toContain("runId")
    expect(source).toContain("setReviewRun")
  })

  it("审稿完成后通过 finishReviewRun 匹配 runId 写回结果", () => {
    expect(source).toContain("finishReviewRun(runId")
  })

  it("finally 块检查 runId 匹配后写回 running: false", () => {
    expect(source).toContain("current?.runId === runId")
  })

  it("错误时使用 finishReviewRun 写回 error", () => {
    expect(source).toContain('t("novel.review.runFailed")')
  })

  it("错误 UI 不遮挡已有结果和历史", () => {
    expect(source).toContain("reviewError")
    expect(source).toContain("{reviewError && (")
    expect(source).toContain("pending.length === 0 && resolved.length === 0 && novelReviewActionItems.length === 0 && !showReviewHistory")
  })

  it("审稿结果卡片支持直接跳到对应正文编辑", () => {
    expect(source).toContain("openNovelReviewActionItem")
    expect(source).toContain("reviewRun?.filePath")
    expect(source).toContain("onClick={() => void openNovelReviewActionItem(item)}")
  })
})

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "dashboard-view.tsx"), "utf8")

describe("dashboard-view 仪表盘动作", () => {
  it("支持点击结果后打开对应内容", () => {
    expect(source).toContain("handleOpenDashItem")
    expect(source).toContain("targetPath")
    expect(source).toContain('setActiveView("wiki")')
    expect(source).toContain("onClick={() => void handleOpenDashItem(item)}")
  })

  it("事实检查结果保留章节定位信息", () => {
    expect(source).toContain("targetChapterNumber")
    expect(source).toContain("chapters[1]")
  })

  it("为卡片提供编辑、AI修改、忽略和恢复原文入口", () => {
    expect(source).toContain("handleEditDashItem")
    expect(source).toContain("dashboard.actions.aiRewrite")
    expect(source).toContain("dashboard.actions.ignore")
    expect(source).toContain("dashboard.actions.restore")
  })

  it("章节路径失效时会回退到章节号或文件名搜索", () => {
    expect(source).toContain("getFileStem")
    expect(source).toContain("extractChapterNumberFromTargetPath")
    expect(source).toContain("chapter_number:")
  })

  it("AI修改失败时会给出可见反馈，并在生成时禁用确认按钮", () => {
    expect(source).toContain("showAiRewriteAlert")
    expect(source).toContain("正在生成修改内容，请稍候")
    expect(source).toContain("applyDisabled=")
  })
  it("事实检查的AI修改会走章节级补写，而不是直接改写定位片段", () => {
    expect(source).toContain('item.source === "factcheck"')
    expect(source).toContain("buildFactCheckInsertMessages")
    expect(source).toContain('mode: "insert_before"')
  })
})

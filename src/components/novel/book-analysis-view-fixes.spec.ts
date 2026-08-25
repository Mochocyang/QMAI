import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "book-analysis-view.tsx"), "utf8")

describe("book-analysis-view 三个修复点的接线（fix/view-result-routing / fix/recognized-persist）", () => {
  it("问题1：识别角色生成 Skill 前先持久化为角色档案", () => {
    expect(source).toContain("recognizedCharacterToExtracted")
    expect(source).toContain("persistCharacterToDisk")
    expect(source).toContain("selectedLibraryBook.recognizedCharacters")
  })

  it("问题3：任务完成 Toast「查看结果」按技能路由到对应页签", () => {
    expect(source).toContain("analysisTabForSkills(task.selectedSkills)")
    expect(source).toContain("setModuleActiveTab(tab)")
    // Toast 点击时先定位任务所属作品
    expect(source).toContain("handleSelectBook(task.bookId)")
  })

  it("问题3：角色任务完成 Toast 定位作品后打开角色弹窗（不再打开旧查看器）", () => {
    expect(source).toContain('label: "打开角色信息"')
    expect(source).toContain("setCharacterSkillDialogOpen(true)")
  })

  it("问题3：故事任务完成递增刷新键，故事页签自动重读历史导图", () => {
    expect(source).toContain("setStoryMapRefreshKey((key) => key + 1)")
    expect(source).toContain("storyMapRefreshKey={storyMapRefreshKey}")
  })

  it("受控页签状态接入布局", () => {
    expect(source).toContain('useState<BookAnalysisModuleTab>("characters")')
    expect(source).toContain("analysisActiveTab={moduleActiveTab}")
    expect(source).toContain("onAnalysisActiveTabChange={setModuleActiveTab}")
  })
})

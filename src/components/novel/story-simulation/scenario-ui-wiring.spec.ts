import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8")
}

const setupPanel = () =>
  read("src/components/novel/story-simulation/scenario-setup-panel.tsx")
const roomView = () =>
  read("src/components/novel/story-simulation/scenario-room-view.tsx")
const view = () =>
  read("src/components/novel/story-simulation/story-simulation-view.tsx")

describe("舞台情景 · 设置面板接线", () => {
  it("提供角色数量、下拉选择与灵魂展示", () => {
    const src = setupPanel()
    expect(src).toContain("storySimulation.scenarioCharacterCount")
    expect(src).toContain("<select")
    expect(src).toContain("storySimulation.scenarioAddPlaceholder")
    expect(src).toContain("storySimulation.scenarioSoul")
    expect(src).toContain("storySimulation.scenarioNoSoul")
  })

  it("提供提取章节数与重新分析角色", () => {
    const src = setupPanel()
    expect(src).toContain("storySimulation.scenarioSourceChapters")
    expect(src).toContain("onSourceChaptersChange")
    expect(src).toContain("onReExtract")
    expect(src).toContain("storySimulation.scenarioReExtract")
  })

  it("提供主持人、串场间隔与行为说明", () => {
    const src = setupPanel()
    expect(src).toContain("storySimulation.scenarioModerator")
    expect(src).toContain("storySimulation.scenarioModeratorInterval")
    expect(src).toContain("storySimulation.scenarioModeratorRoleBehavior")
    expect(src).toContain("storySimulation.scenarioModeratorUserBehavior")
  })

  it("提供成本护栏：预估条数超过阈值需勾选确认", () => {
    const src = setupPanel()
    expect(src).toContain("estimateScenarioMessages")
    expect(src).toContain("SCENARIO_COST_WARN_THRESHOLD")
    expect(src).toContain("storySimulation.scenarioCostWarn")
    expect(src).toContain("storySimulation.scenarioCostAck")
    expect(src).toContain("costAck")
  })

  it("提供历史情景列表与查看/删除入口", () => {
    const src = setupPanel()
    expect(src).toContain("storySimulation.scenarioHistory")
    expect(src).toContain("onOpenSaved")
    expect(src).toContain("onDeleteSaved")
  })
})

describe("舞台情景 · 房间视图接线", () => {
  it("提供复制全部（写入剪贴板并给出反馈）", () => {
    const src = roomView()
    expect(src).toContain("storySimulation.scenarioCopyAll")
    expect(src).toContain("storySimulation.scenarioCopied")
    expect(src).toContain("navigator.clipboard.writeText")
  })

  it("提供导出与插入到章节", () => {
    const src = roomView()
    expect(src).toContain("storySimulation.scenarioExport")
    expect(src).toContain("onInsertToChapters")
    expect(src).toContain("storySimulation.scenarioInsertToChapter")
    expect(src).toContain("storySimulation.scenarioInserting")
  })

  it("群组式对话流包含主持人/角色/用户三类气泡", () => {
    const src = roomView()
    expect(src).toContain("MessageBubble")
    expect(src).toContain('kind === "moderator"')
    expect(src).toContain("isUser")
    expect(src).toContain("storySimulation.scenarioScheduling")
  })
})

describe("舞台情景 · 主视图接线", () => {
  it("注册两个 phase 分支并接入设置面板与房间视图", () => {
    const src = view()
    expect(src).toContain('phase === "scenario-setup"')
    expect(src).toContain('phase === "scenario-running"')
    expect(src).toContain("<ScenarioSetupPanel")
    expect(src).toContain("<ScenarioRoomView")
  })

  it("接入引擎、持久化、导出与导入", () => {
    const src = view()
    expect(src).toContain("runScenario")
    expect(src).toContain("continueScenario")
    expect(src).toContain("saveScenario")
    expect(src).toContain("loadScenarios")
    expect(src).toContain("deleteScenario")
    expect(src).toContain("exportScenario")
    expect(src).toContain("importScenarioToChapter")
    expect(src).toContain("handleOpenSavedScenario")
    expect(src).toContain("handleDeleteSavedScenario")
  })

  it("按提取章节数去重，避免重复提取", () => {
    const src = view()
    expect(src).toContain("scenarioExtractedSigRef")
    expect(src).toContain("scenarioExtractNonce")
  })
})

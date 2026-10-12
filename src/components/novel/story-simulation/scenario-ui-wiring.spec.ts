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

describe("舞台情景 · 流式状态带 speakerId", () => {
  it("ScenarioStreamingState 有 speakerId 字段", () => {
    const src = read("src/lib/novel/story-simulation/scenario-types.ts")
    expect(src).toContain("export interface ScenarioStreamingState")
    // speakerId 后也要容空白：漏了它会漏检 `speakerId ?: string`
    expect(src).toMatch(/speakerId\s*\?\s*:\s*string/)
  })
})

describe("舞台情景 · 设置面板接线", () => {
  it("提供角色数量（含自定义）与候选网格，不再是下拉框选人", () => {
    const src = setupPanel()
    expect(src).toContain("storySimulation.scenarioCharacterCount")
    expect(src).toContain("SCENARIO_CHARACTER_PRESETS")
    expect(src).toContain("clampScenarioCharacterCount")
    expect(src).toContain("<ScenarioCharacterGrid")
    // 角色下拉已被网格取代；<select> 只剩「提取章节数」这一个，不再是选人用的
    expect(src).not.toContain("storySimulation.scenarioAddPlaceholder")
    expect(src).not.toContain("storySimulation.scenarioNoSoul")
  })

  it("把绑定灵魂的入口接进设置面板", () => {
    const src = setupPanel()
    expect(src).toContain("<ScenarioSoulBindDialog")
    expect(src).toContain("onSoulChanged")
    // 灵魂入口挂在候选卡片上，由网格上报
    expect(src).toContain("onBindSoul")
  })

  it("情景设定加宽到 max-w-5xl，并给四个输入框补上标签", () => {
    const src = setupPanel()
    // 容器放宽（提取中那个分支的 max-w-2xl 不动）
    expect(src).toContain("max-w-5xl")
    // 地点 / 时间 一行两个，窄屏退回一列，不再挤在写死的两列里
    expect(src).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2")
    expect(src).toContain("storySimulation.scenarioSceneLabel")
    expect(src).toContain("storySimulation.scenarioLocationLabel")
    expect(src).toContain("storySimulation.scenarioTimeLabel")
    expect(src).toContain("storySimulation.scenarioReferenceLabel")
    // 情景标题从「生成轮数」那一节归位到情景设定
    expect(src).toContain("storySimulation.scenarioTitleLabel")
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

  it("把「继续生成剩余轮数」接进房间视图", () => {
    const src = view()
    expect(src).toContain("handleScenarioContinue")
    expect(src).toContain("onContinue=")
    expect(src).toContain("remainingRounds=")
    // 必须从「已经说到的下一轮」接着跑，并把串场节奏钉在绝对轮次上
    expect(src).toContain("initialMessages: continuedFrom.messages")
    expect(src).toContain("moderatorOriginRound: 1")
  })

  it("三条生成路径都把参考点资料送进引擎", () => {
    const src = view()
    expect(src).toContain("collectScenarioReferenceMaterial")
    expect(src).toContain("resolveScenarioReference")
    // 开场、插话、续跑都必须带资料，漏一条就会出现「同一场里前后依据不同」
    const passed = src.match(/referenceMaterial/g) ?? []
    expect(passed.length).toBeGreaterThanOrEqual(4)
    expect(src).toContain("referenceInfo={scenarioReferenceInfo}")
  })
})

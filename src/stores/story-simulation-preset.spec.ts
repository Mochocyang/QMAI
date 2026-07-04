import { beforeEach, describe, expect, it } from "vitest"
import { useStorySimulationStore } from "./story-simulation-store"
import type { SimulationPreset } from "./story-simulation-store"

describe("story simulation store initWithPreset", () => {
  beforeEach(() => {
    useStorySimulationStore.setState({
      phase: "idle",
      userIdea: "",
      savedResults: [],
      currentFramework: null,
    })
  })

  it("story_framework_generate: sets phase to configuring", () => {
    const preset: SimulationPreset = {
      intent: "story_framework_generate",
      userInput: "生成一个悬疑故事框架",
      hasFramework: false,
    }

    useStorySimulationStore.getState().initWithPreset(preset)

    const state = useStorySimulationStore.getState()
    expect(state.phase).toBe("configuring")
    expect(state.userIdea).toBe("生成一个悬疑故事框架")
  })

  it("multi_agent_simulate: hasFramework=true sets phase to simulating", () => {
    const preset: SimulationPreset = {
      intent: "multi_agent_simulate",
      userInput: "推演一下主角发现真相后的剧情走向",
      hasFramework: true,
    }

    useStorySimulationStore.getState().initWithPreset(preset)

    const state = useStorySimulationStore.getState()
    expect(state.phase).toBe("simulating")
    expect(state.userIdea).toBe("推演一下主角发现真相后的剧情走向")
  })

  it("multi_agent_simulate: hasFramework=false sets phase to configuring", () => {
    const preset: SimulationPreset = {
      intent: "multi_agent_simulate",
      userInput: "推演剧情走向",
      hasFramework: false,
    }

    useStorySimulationStore.getState().initWithPreset(preset)

    const state = useStorySimulationStore.getState()
    expect(state.phase).toBe("configuring")
    expect(state.userIdea).toBe("推演剧情走向")
  })

  it("character_interview: hasFramework=true and savedResults sets phase to report-viewing", () => {
    useStorySimulationStore.setState({
      savedResults: [
        {
          id: "result-1",
          frameworkId: "fw-1",
          report: {
            recommendation: "测试推荐",
            createdAt: "2026-07-03T00:00:00.000Z",
          } as any,
          createdAt: "2026-07-03T00:00:00.000Z",
        },
      ],
    })

    const preset: SimulationPreset = {
      intent: "character_interview",
      userInput: "采访主角李明",
      hasFramework: true,
    }

    useStorySimulationStore.getState().initWithPreset(preset)

    const state = useStorySimulationStore.getState()
    expect(state.phase).toBe("report-viewing")
    expect(state.userIdea).toBe("采访主角李明")
  })

  it("character_interview: hasFramework=true but no savedResults sets phase to configuring", () => {
    useStorySimulationStore.setState({
      savedResults: [],
    })

    const preset: SimulationPreset = {
      intent: "character_interview",
      userInput: "问角色一个问题",
      hasFramework: true,
    }

    useStorySimulationStore.getState().initWithPreset(preset)

    const state = useStorySimulationStore.getState()
    expect(state.phase).toBe("configuring")
    expect(state.userIdea).toBe("问角色一个问题")
  })

  it("character_interview: hasFramework=false sets phase to configuring", () => {
    const preset: SimulationPreset = {
      intent: "character_interview",
      userInput: "角色采访",
      hasFramework: false,
    }

    useStorySimulationStore.getState().initWithPreset(preset)

    const state = useStorySimulationStore.getState()
    expect(state.phase).toBe("configuring")
    expect(state.userIdea).toBe("角色采访")
  })

  it("unknown intent defaults to configuring", () => {
    const preset: SimulationPreset = {
      intent: "unknown_intent",
      userInput: "测试输入",
      hasFramework: true,
    }

    useStorySimulationStore.getState().initWithPreset(preset)

    const state = useStorySimulationStore.getState()
    expect(state.phase).toBe("configuring")
    expect(state.userIdea).toBe("测试输入")
  })
})

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("story simulation debug process view wiring", () => {
  it("wires debug traces from the simulation engine into the simulating panel", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/novel/story-simulation/story-simulation-view.tsx",
      ),
      "utf8",
    )

    expect(source).toContain("debugTraces")
    expect(source).toContain("setDebugTraces")
    expect(source).toContain("addDebugTrace")
    expect(source).toContain("onDebugTrace")
    expect(source).toContain("debugTraces={debugTraces}")
  })

  it("renders a timeline and process observation switch in the simulating panel", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/novel/story-simulation/story-simulation-view.tsx",
      ),
      "utf8",
    )

    expect(source).toContain("时间线")
    expect(source).toContain("概览")
    expect(source).toContain("ProcessDebugPanel")
    expect(source).toContain("Blackboard")
    expect(source).toContain("可见事件")
  })

  it("forwards the panel director switch into runSimulation and the state snapshot", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/novel/story-simulation/story-simulation-view.tsx",
      ),
      "utf8",
    )

    // 面板勾选的导演开关必须真的传进引擎
    expect(source).toContain("directorEnabled: directorEnabledForRun")
    // 评估结果必须被回传并累积（分支评分与评分对比页依赖它）
    expect(source).toContain("onDirectorEvaluation")
    expect(source).toContain("addDirectorEvaluation")
    // 回归保护：此前传给采访功能的状态里 directorEnabled 被写死为 false
    expect(source).not.toContain("directorEnabled: false")
  })
})

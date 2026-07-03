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
    expect(source).toContain("过程观察")
    expect(source).toContain("ProcessDebugPanel")
    expect(source).toContain("Blackboard")
    expect(source).toContain("可见事件")
  })
})

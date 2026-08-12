import { describe, expect, it } from "vitest"
import {
  DEFAULT_AI_WORKFLOW_MODE,
  getWorkflowModeLabel,
  resolveAiWorkflowMode,
  type AiWorkflowMode,
} from "./workflow-mode"

describe("workflow mode", () => {
  it("keeps the default workflow mode at standard", () => {
    expect(DEFAULT_AI_WORKFLOW_MODE).toBe("standard")
  })

  it("defaults nullish values to the standard workflow mode", () => {
    expect(resolveAiWorkflowMode(null)).toBe("standard")
    expect(resolveAiWorkflowMode(undefined)).toBe("standard")
  })

  it("accepts explicit active workflow modes without changing them", () => {
    const modes: AiWorkflowMode[] = ["fast", "standard", "strict"]

    expect(modes.map(resolveAiWorkflowMode)).toEqual(modes)
  })

  it("returns Chinese labels for each workflow mode", () => {
    expect(getWorkflowModeLabel("fast")).toBe("快速")
    expect(getWorkflowModeLabel("standard")).toBe("标准")
    expect(getWorkflowModeLabel("strict")).toBe("严格")
  })
})

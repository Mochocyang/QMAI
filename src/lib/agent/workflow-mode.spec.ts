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

  it("maps the legacy deep chapter toggle to the new workflow mode", () => {
    expect(resolveAiWorkflowMode(false)).toBe("standard")
    expect(resolveAiWorkflowMode(true)).toBe("strict")
  })

  it("accepts explicit workflow modes without changing them", () => {
    const modes: AiWorkflowMode[] = ["fast", "standard", "strict"]

    expect(modes.map(resolveAiWorkflowMode)).toEqual(modes)
  })

  it("returns Chinese labels for each workflow mode", () => {
    expect(getWorkflowModeLabel("fast")).toBe("快速")
    expect(getWorkflowModeLabel("standard")).toBe("标准")
    expect(getWorkflowModeLabel("strict")).toBe("严格")
  })
})

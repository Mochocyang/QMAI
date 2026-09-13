import { describe, expect, it } from "vitest"
import {
  DEFAULT_AI_WORKFLOW_MODE,
  DEFAULT_OUTLINE_WORKFLOW_MODE,
  getWorkflowModeLabel,
  isOutlineWorkflowMode,
  resolveAiWorkflowMode,
  resolveOutlineWorkflowMode,
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

  it("defaults invalid values to the standard workflow mode", () => {
    expect(resolveAiWorkflowMode("normal")).toBe("standard")
    expect(resolveAiWorkflowMode("")).toBe("standard")
    expect(resolveAiWorkflowMode(1)).toBe("standard")
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

  it("keeps the default outline workflow mode at standard", () => {
    expect(DEFAULT_OUTLINE_WORKFLOW_MODE).toBe("standard")
  })

  it("maps outline workflow mode to fast, standard or plan only", () => {
    expect(resolveOutlineWorkflowMode("fast")).toBe("fast")
    expect(resolveOutlineWorkflowMode("standard")).toBe("standard")
    expect(resolveOutlineWorkflowMode("plan")).toBe("plan")
    expect(resolveOutlineWorkflowMode("strict")).toBe("standard")
    expect(resolveOutlineWorkflowMode(null)).toBe("standard")
    expect(resolveOutlineWorkflowMode(undefined)).toBe("standard")
  })

  it("recognises outline workflow modes without accepting writing-only modes", () => {
    expect(isOutlineWorkflowMode("fast")).toBe(true)
    expect(isOutlineWorkflowMode("standard")).toBe(true)
    expect(isOutlineWorkflowMode("plan")).toBe(true)
    expect(isOutlineWorkflowMode("strict")).toBe(false)
    expect(isOutlineWorkflowMode(null)).toBe(false)
  })
})

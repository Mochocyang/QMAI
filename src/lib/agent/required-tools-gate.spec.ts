import { describe, expect, it } from "vitest"
import {
  RequiredToolFallbackError,
  RequiredToolsNotCalledError,
  buildRequiredToolNudgeMessage,
  missingRequiredToolsOnce,
  resolveRequiredToolsOnce,
  shouldBlockFinalWithoutRequiredTools,
} from "./required-tools-gate"

describe("required-tools-gate", () => {
  it("does not block when no required tools configured", () => {
    expect(
      shouldBlockFinalWithoutRequiredTools({
        availableToolNames: ["run_chapter_workflow"],
        calledToolNames: [],
        toolsEnabled: true,
      }),
    ).toBe(false)
  })

  it("blocks when required tool is available but not called", () => {
    const missing = missingRequiredToolsOnce({
      requiredToolsOnce: ["run_chapter_workflow"],
      availableToolNames: ["read_chapter", "run_chapter_workflow"],
      calledToolNames: ["read_chapter"],
      toolsEnabled: true,
    })
    expect(missing).toEqual(["run_chapter_workflow"])
    expect(
      shouldBlockFinalWithoutRequiredTools({
        requiredToolsOnce: ["run_chapter_workflow"],
        availableToolNames: ["run_chapter_workflow"],
        calledToolNames: [],
        toolsEnabled: true,
      }),
    ).toBe(true)
  })

  it("does not block when required tool was already called", () => {
    expect(
      shouldBlockFinalWithoutRequiredTools({
        requiredToolsOnce: ["run_chapter_workflow"],
        availableToolNames: ["run_chapter_workflow"],
        calledToolNames: ["run_chapter_workflow"],
        toolsEnabled: true,
      }),
    ).toBe(false)
  })

  it("does not block when tools are disabled", () => {
    expect(
      shouldBlockFinalWithoutRequiredTools({
        requiredToolsOnce: ["run_chapter_workflow"],
        availableToolNames: ["run_chapter_workflow"],
        calledToolNames: [],
        toolsEnabled: false,
      }),
    ).toBe(false)
  })

  it("ignores required tools that are not available", () => {
    expect(
      missingRequiredToolsOnce({
        requiredToolsOnce: ["run_chapter_workflow"],
        availableToolNames: ["read_chapter"],
        calledToolNames: [],
        toolsEnabled: true,
      }),
    ).toEqual([])
  })

  it("builds a Chinese nudge that forbids direct final prose", () => {
    const message = buildRequiredToolNudgeMessage(["run_chapter_workflow"])
    expect(message).toContain("禁止直接输出章节终稿")
    expect(message).toContain("run_chapter_workflow")
  })

  it("RequiredToolsNotCalledError names missing tools", () => {
    const err = new RequiredToolsNotCalledError(["run_chapter_workflow"])
    expect(err.name).toBe("RequiredToolsNotCalledError")
    expect(err.message).toContain("run_chapter_workflow")
    expect(err.missingTools).toEqual(["run_chapter_workflow"])
  })

  it("RequiredToolFallbackError preserves the workflow and underlying reason", () => {
    const err = new RequiredToolFallbackError("run_chapter_workflow", "正文为空")
    expect(err.name).toBe("RequiredToolFallbackError")
    expect(err.toolName).toBe("run_chapter_workflow")
    expect(err.message).toContain("正文为空")
    expect(err.message).not.toContain("模型未调用")
  })
})

describe("resolveRequiredToolsOnce", () => {
  it("requires workflow for non-fast chapter writing when tool is enabled", () => {
    expect(
      resolveRequiredToolsOnce({
        novelMode: true,
        intent: "write_chapter",
        mode: "strict",
        planExecuteActive: false,
        enabledToolNames: ["read_chapter", "run_chapter_workflow"],
      }),
    ).toEqual(["run_chapter_workflow"])

    expect(
      resolveRequiredToolsOnce({
        novelMode: true,
        intent: "polish_chapter",
        mode: "standard",
        planExecuteActive: false,
      }),
    ).toEqual(["run_chapter_workflow"])
  })

  it("skips fast mode, plan phase, non-novel, and non-writing intents", () => {
    expect(
      resolveRequiredToolsOnce({
        novelMode: true,
        intent: "write_chapter",
        mode: "fast",
        planExecuteActive: false,
        enabledToolNames: ["run_chapter_workflow"],
      }),
    ).toBeUndefined()

    expect(
      resolveRequiredToolsOnce({
        novelMode: true,
        intent: "write_chapter",
        mode: "strict",
        planExecuteActive: true,
        enabledToolNames: ["run_chapter_workflow"],
      }),
    ).toBeUndefined()

    expect(
      resolveRequiredToolsOnce({
        novelMode: false,
        intent: "write_chapter",
        mode: "strict",
        planExecuteActive: false,
      }),
    ).toBeUndefined()

    expect(
      resolveRequiredToolsOnce({
        novelMode: true,
        intent: "character_query",
        mode: "strict",
        planExecuteActive: false,
      }),
    ).toBeUndefined()
  })

  it("skips when enabledToolNames explicitly omits the workflow tool", () => {
    expect(
      resolveRequiredToolsOnce({
        novelMode: true,
        intent: "write_chapter",
        mode: "strict",
        planExecuteActive: false,
        enabledToolNames: ["read_chapter", "read_outline"],
      }),
    ).toBeUndefined()
  })
})

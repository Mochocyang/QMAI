import { afterEach, describe, expect, it } from "vitest"
import {
  cliModelToAcpValue,
  inferCursorEffortFromModel,
  inferCursorSpeedModeFromModel,
  pickCursorCliCatalogId,
  rememberCursorCliCatalog,
  resolveCursorSpeedMode,
  toCursorAcpEffort,
  toCursorAcpModelId,
  toCursorAcpModelIds,
  toCursorAcpModelValue,
  toCursorHttpModel,
} from "./cursor-acp-models"

afterEach(() => {
  rememberCursorCliCatalog([])
})

describe("toCursorAcpModelId", () => {
  it("maps the extract CLI id to the ACP catalog name", () => {
    expect(toCursorAcpModelId("cursor-grok-4.6-medium-fast")).toBe("grok-4.6")
  })

  it("collapses CLI effort/fast variants onto one ACP name", () => {
    expect(toCursorAcpModelId("cursor-grok-4.6-high-fast")).toBe("grok-4.6")
    expect(toCursorAcpModelId("cursor-grok-4.6-low")).toBe("grok-4.6")
    expect(toCursorAcpModelId("claude-opus-4-7-medium-fast")).toBe("claude-opus-4-7")
    expect(toCursorAcpModelId("claude-opus-4-7-thinking-max")).toBe("claude-opus-4-7")
    expect(toCursorAcpModelId("gpt-5.3-codex-high")).toBe("gpt-5.3-codex")
  })

  it("aliases leftover print-mode ids", () => {
    expect(toCursorAcpModelId("composer-2-fast")).toBe("composer-2.5")
    expect(toCursorAcpModelId("auto")).toBe("default")
  })

  it("keeps ACP names and parameterized ids", () => {
    expect(toCursorAcpModelId("grok-4.6")).toBe("grok-4.6")
    expect(toCursorAcpModelId("grok-4.6[effort=high,fast=true]")).toBe("grok-4.6")
    expect(toCursorAcpModelId("default")).toBe("default")
  })
})

describe("toCursorAcpModelIds", () => {
  it("dedupes CLI variants", () => {
    expect(
      toCursorAcpModelIds([
        "cursor-grok-4.6-medium-fast",
        "cursor-grok-4.6-high",
        "composer-2-fast",
        "grok-4.6",
      ]),
    ).toEqual(["grok-4.6", "composer-2.5"])
  })
})

describe("resolveCursorSpeedMode", () => {
  it("infers Fast from old CLI ids and ACP parameters", () => {
    expect(inferCursorSpeedModeFromModel("cursor-grok-4.6-medium-fast")).toBe("fast")
    expect(inferCursorSpeedModeFromModel("cursor-grok-4.6-high")).toBe("standard")
    expect(inferCursorSpeedModeFromModel("grok-4.6[effort=high,fast=true]")).toBe("fast")
    expect(inferCursorSpeedModeFromModel("grok-4.6")).toBe("fast")
  })

  it("prefers the saved switch over model-id inference", () => {
    expect(resolveCursorSpeedMode("standard", "cursor-grok-4.6-medium-fast")).toBe("standard")
    expect(resolveCursorSpeedMode("fast", "cursor-grok-4.6-high")).toBe("fast")
  })

  it("maps reasoning mode onto ACP effort", () => {
    expect(toCursorAcpEffort({ mode: "high" })).toBe("high")
    expect(toCursorAcpEffort({ mode: "max" })).toBe("xhigh")
    expect(toCursorAcpEffort({ mode: "auto" })).toBeUndefined()
  })

  it("reads effort from CLI ids and ACP parameters", () => {
    expect(inferCursorEffortFromModel("cursor-grok-4.6-medium-fast")).toBe("medium")
    expect(inferCursorEffortFromModel("cursor-grok-4.6-high")).toBe("high")
    expect(inferCursorEffortFromModel("grok-4.6[effort=high,fast=true]")).toBe("high")
    expect(inferCursorEffortFromModel("composer-2-fast")).toBeUndefined()
  })
})

const CATALOG = [
  "cursor-grok-4.6-medium-fast",
  "cursor-grok-4.6-high",
  "composer-2-fast",
]

describe("pickCursorCliCatalogId", () => {
  it("picks the grok CLI id that matches Fast and effort", () => {
    expect(pickCursorCliCatalogId("grok-4.6", true, "medium", CATALOG)).toBe(
      "cursor-grok-4.6-medium-fast",
    )
  })

  it("picks composer-2-fast for composer-2.5 and does not use grok", () => {
    expect(pickCursorCliCatalogId("composer-2.5", true, undefined, CATALOG)).toBe("composer-2-fast")
  })

  it("picks a real CLI id for gemini, not an ACP parameterized value", () => {
    expect(
      pickCursorCliCatalogId("gemini-3.7-flash", true, "high", [
        "gemini-3.7-flash-low",
        "gemini-3.7-flash-medium",
        "gemini-3.7-flash-high",
        "cursor-grok-4.6-medium-fast",
      ]),
    ).toBe("gemini-3.7-flash-high")
  })

  it("falls back to a cursor-prefixed heuristic when the catalog is empty", () => {
    expect(pickCursorCliCatalogId("grok-4.6", true, "medium", [])).toBe(
      "cursor-grok-4.6-medium-fast",
    )
    expect(pickCursorCliCatalogId("composer-2.5", true, undefined, [])).toBe("composer-2-fast")
  })

  it("keeps Auto as default", () => {
    expect(pickCursorCliCatalogId("auto", true, undefined, CATALOG)).toBe("default")
    expect(pickCursorCliCatalogId("default", true, undefined, CATALOG)).toBe("default")
  })
})

describe("toCursorAcpModelValue", () => {
  it("matches the rust pin format", () => {
    expect(toCursorAcpModelValue("grok-4.6")).toBe("grok-4.6")
    expect(toCursorAcpModelValue("grok-4.6", true, "medium")).toBe(
      "grok-4.6[effort=medium,fast=true]",
    )
    expect(toCursorAcpModelValue("composer-2.5", false)).toBe("composer-2.5[fast=false]")
  })
})

describe("cliModelToAcpValue", () => {
  it("rewrites CLI ids from the argv string itself", () => {
    expect(cliModelToAcpValue("cursor-grok-4.6-medium-fast")).toBe(
      "grok-4.6[effort=medium,fast=true]",
    )
    expect(cliModelToAcpValue("cursor-grok-4.6-high")).toBe("grok-4.6[effort=high,fast=false]")
    expect(cliModelToAcpValue("composer-2-fast")).toBe("composer-2.5[fast=true]")
    expect(cliModelToAcpValue("grok-4.6")).toBe("grok-4.6")
    expect(cliModelToAcpValue("default")).toBe("")
  })
})

describe("toCursorHttpModel", () => {
  it("passes the saved id through and does not remap ACP names", () => {
    expect(toCursorHttpModel("cursor-grok-4.6-medium-fast")).toBe("cursor-grok-4.6-medium-fast")
    expect(toCursorHttpModel("cursor-grok-4.6-high")).toBe("cursor-grok-4.6-high")
    expect(toCursorHttpModel("grok-4.6")).toBe("grok-4.6")
    expect(toCursorHttpModel("composer-2-fast")).toBe("composer-2-fast")
    expect(toCursorHttpModel("auto")).toBe("default")
  })
})

import { afterEach, describe, expect, it } from "vitest"
import {
  cliIdMatchesAcp,
  cliModelToAcpValue,
  filterCursorCliByAcp,
  inferCursorEffortFromModel,
  inferCursorSpeedModeFromModel,
  parseCursorAcpModelId,
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

describe("parseCursorAcpModelId", () => {
  it("reads family plus effort/fast/reasoning", () => {
    expect(parseCursorAcpModelId("grok-4.6[effort=high,fast=true]")).toEqual({
      name: "grok-4.6",
      effort: "high",
      fast: true,
    })
    expect(parseCursorAcpModelId("gemini-3.7-flash[effort=high]")).toEqual({
      name: "gemini-3.7-flash",
      effort: "high",
    })
    expect(parseCursorAcpModelId("gpt-5.3-codex[reasoning=medium,fast=false]")).toEqual({
      name: "gpt-5.3-codex",
      reasoning: "medium",
      fast: false,
    })
    expect(parseCursorAcpModelId("default[]")).toEqual({ name: "default" })
  })
})

const ACP_CATALOG = [
  { name: "Auto", modelId: "default[]" },
  { name: "grok-4.6", modelId: "grok-4.6[effort=high,fast=true]" },
  { name: "composer-2.5", modelId: "composer-2.5[fast=true]" },
  { name: "claude-opus-5", modelId: "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]" },
  { name: "claude-opus-4-8", modelId: "claude-opus-4-8[thinking=true,context=300k,effort=high,fast=false]" },
  { name: "gpt-5.6-sol", modelId: "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]" },
  { name: "gpt-5.5", modelId: "gpt-5.5[context=272k,reasoning=medium,fast=false]" },
  { name: "claude-fable-5-1", modelId: "claude-fable-5-1[thinking=true,context=300k,effort=high]" },
  { name: "claude-fable-5", modelId: "claude-fable-5[thinking=true,context=300k,effort=high]" },
  { name: "grok-4.5", modelId: "grok-4.5[effort=high,fast=true]" },
  { name: "gemini-3.7-flash", modelId: "gemini-3.7-flash[effort=high]" },
  { name: "gpt-5.6-terra", modelId: "gpt-5.6-terra[context=272k,reasoning=medium,fast=false]" },
  { name: "claude-sonnet-5", modelId: "claude-sonnet-5[thinking=true,context=300k,effort=high]" },
  { name: "claude-sonnet-4-6", modelId: "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]" },
  { name: "gpt-5.3-codex", modelId: "gpt-5.3-codex[reasoning=medium,fast=false]" },
  { name: "claude-opus-4-7", modelId: "claude-opus-4-7[thinking=true,context=300k,effort=xhigh,fast=false]" },
  { name: "gpt-5.4", modelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]" },
  { name: "claude-opus-4-6", modelId: "claude-opus-4-6[thinking=true,context=200k,effort=high]" },
  { name: "claude-opus-4-5", modelId: "claude-opus-4-5[thinking=true]" },
  { name: "gpt-5.2", modelId: "gpt-5.2[reasoning=medium,fast=false]" },
  { name: "gpt-5.6-luna", modelId: "gpt-5.6-luna[context=272k,reasoning=medium,fast=false]" },
  { name: "gemini-3.6-flash", modelId: "gemini-3.6-flash[effort=high]" },
  { name: "gemini-3.1-pro", modelId: "gemini-3.1-pro[]" },
  { name: "gpt-5.4-mini", modelId: "gpt-5.4-mini[reasoning=medium]" },
  { name: "gpt-5.4-nano", modelId: "gpt-5.4-nano[reasoning=medium]" },
  { name: "claude-haiku-4-5", modelId: "claude-haiku-4-5[thinking=true]" },
  { name: "claude-sonnet-4-5", modelId: "claude-sonnet-4-5[thinking=true,context=200k]" },
  { name: "gpt-5.1", modelId: "gpt-5.1[reasoning=medium]" },
  { name: "gemini-3.5-flash", modelId: "gemini-3.5-flash[]" },
  { name: "claude-sonnet-4", modelId: "claude-sonnet-4[thinking=false,context=200k]" },
  { name: "gpt-5-mini", modelId: "gpt-5-mini[]" },
  { name: "gemini-2.5-flash", modelId: "gemini-2.5-flash[]" },
  { name: "kimi-k3", modelId: "kimi-k3[reasoning=max]" },
  { name: "kimi-k2.7-code", modelId: "kimi-k2.7-code[]" },
  { name: "glm-5.2", modelId: "glm-5.2[reasoning=high]" },
  { name: "gemini-3-flash", modelId: "gemini-3-flash[]" },
]

const CLI_WITH_PHANTOMS = [
  "auto",
  "cursor-grok-4.6-medium-fast",
  "cursor-grok-4.6-high-fast",
  "cursor-grok-4.6-low",
  "composer-2-fast",
  "composer-2.5-fast",
  "gemini-3.7-flash-low",
  "gemini-3.7-flash-medium",
  "gemini-3.7-flash-high",
  "gemini-3.1-pro",
  "claude-opus-4-7-medium-fast",
  "claude-opus-4-7-thinking-max",
  "gpt-5.3-codex-medium",
  "kimi-k3-max",
  "acp-only-missing-from-cli",
]

describe("cliIdMatchesAcp", () => {
  it("does not treat gemini-high as fast just because Fast defaults to on", () => {
    const high = parseCursorAcpModelId("gemini-3.7-flash[effort=high]")
    expect(cliIdMatchesAcp("gemini-3.7-flash-high", high)).toBe(true)
    expect(cliIdMatchesAcp("gemini-3.7-flash-medium", high)).toBe(false)
    expect(cliIdMatchesAcp("gemini-3.7-flash-high-fast", high)).toBe(false)
  })
})

describe("filterCursorCliByAcp", () => {
  it("keeps the CLI id that realizes each ACP variant and drops phantom effort/fast", () => {
    const filtered = filterCursorCliByAcp(CLI_WITH_PHANTOMS, ACP_CATALOG)
    expect(filtered).toContain("auto")
    expect(filtered).toContain("cursor-grok-4.6-high-fast")
    expect(filtered).toContain("gemini-3.7-flash-high")
    expect(filtered).toContain("composer-2.5-fast")
    expect(filtered).toContain("claude-opus-4-7-thinking-max")
    expect(filtered).toContain("gpt-5.3-codex-medium")
    expect(filtered).toContain("kimi-k3-max")
    expect(filtered).toContain("gemini-3.1-pro")
    expect(filtered).not.toContain("cursor-grok-4.6-medium-fast")
    expect(filtered).not.toContain("cursor-grok-4.6-low")
    expect(filtered).not.toContain("gemini-3.7-flash-low")
    expect(filtered).not.toContain("gemini-3.7-flash-medium")
    expect(filtered).not.toContain("claude-opus-4-7-medium-fast")
    expect(filtered).not.toContain("composer-2-fast")
    expect(filtered.every((id) => !id.includes("["))).toBe(true)
  })

  it("throws when the ACP catalog is empty", () => {
    expect(() => filterCursorCliByAcp(CLI_WITH_PHANTOMS, [])).toThrow("ACP catalog 为空")
  })
})

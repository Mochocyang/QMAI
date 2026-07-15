import { describe, expect, it } from "vitest"
import {
  classifyContextSourcePath,
  getDataSourceKinds,
  sortContextSourcePaths,
} from "./source-paths"

const projectPath = "E:/Novel"

describe("context source paths", () => {
  it.each([
    ["E:/Novel/wiki/chapters/chapter-001.md", "chapter"],
    ["E:/Novel/wiki/outlines/main.md", "outline"],
    ["E:/Novel/wiki/memory/伏笔.md", "memory"],
    ["E:/Novel/wiki/entities/林默.md", "entity"],
    ["E:/Novel/wiki/settings/world.md", "setting"],
    ["E:/Novel/.novel/snapshots/001.snapshot.json", "snapshot"],
    ["E:/Novel/.novel/cognition-state.json", "entity"],
    ["E:/Novel/.novel/revision-feedback.json", "snapshot"],
    ["E:/Novel/.novel/timeline.json", "memory"],
    ["E:/Novel/.qmai/writing-style.json", "setting"],
    ["E:/Novel/.qmai/character-aura.json", "entity"],
    ["E:/Novel/.qmai/simulations/latest.json", "deduction"],
    ["E:/Novel/.qmai/context-cache/v1/manifest.json", "ignored"],
  ] as const)("classifies %s as %s", (path, expected) => {
    expect(classifyContextSourcePath(projectPath, path)).toBe(expected)
  })

  it("normalizes separators before deterministic sorting", () => {
    expect(sortContextSourcePaths([
      "E:\\Novel\\wiki\\outlines\\z.md",
      "E:/Novel/wiki/outlines/a.md",
    ])).toEqual([
      "E:/Novel/wiki/outlines/a.md",
      "E:/Novel/wiki/outlines/z.md",
    ])
  })

  it("maps data sources to only their relevant source kinds", () => {
    expect(getDataSourceKinds("outline")).toEqual(["outline"])
    expect(getDataSourceKinds("relatedSettings")).toEqual(["entity", "setting"])
    expect(getDataSourceKinds("recentChapterContents")).toEqual(["chapter"])
    expect(getDataSourceKinds("storyFrameworkBinding")).toEqual(["outline", "setting", "deduction"])
  })
})

import { describe, expect, it } from "vitest"
import {
  buildOutlineListToolResult,
  extractOutlineFolder,
  extractOutlineTypeFields,
  formatOutlineListLine,
  type OutlineListEntry,
} from "./outline-list-helpers"

describe("outline-list-helpers", () => {
  it("extracts type and outline_type from frontmatter", () => {
    expect(
      extractOutlineTypeFields(`---
type: outline
title: "第三卷大纲"
---

正文`),
    ).toEqual({ type: "outline", outlineType: undefined })

    expect(
      extractOutlineTypeFields(`---
type: concept
outline_type: volume-outline
title: "规则"
---
`),
    ).toEqual({ type: "concept", outlineType: "volume-outline" })

    expect(extractOutlineTypeFields("# 无 frontmatter")).toEqual({})
  })

  it("extracts standard outline folder from relative path", () => {
    expect(extractOutlineFolder("章纲/第52章-条件.md")).toBe("章纲")
    expect(extractOutlineFolder("设定/写作通则.md")).toBe("设定")
    expect(extractOutlineFolder("第三卷大纲.md")).toBeUndefined()
    expect(extractOutlineFolder("其他/说明.md")).toBeUndefined()
  })

  it("formats list lines with folder first, then optional type fields", () => {
    const withFolderAndType: OutlineListEntry = {
      relativePath: "卷纲/第三卷.md",
      absolutePath: "/p/wiki/outlines/卷纲/第三卷.md",
      folder: "卷纲",
      type: "outline",
      outlineType: "volume-outline",
    }
    expect(formatOutlineListLine(withFolderAndType, 0)).toBe(
      "1. 卷纲/第三卷.md  folder=卷纲  type=outline  outline_type=volume-outline",
    )

    const folderOnly: OutlineListEntry = {
      relativePath: "章纲/第52章-条件.md",
      absolutePath: "/p/wiki/outlines/章纲/第52章-条件.md",
      folder: "章纲",
    }
    expect(formatOutlineListLine(folderOnly, 1)).toBe(
      "2. 章纲/第52章-条件.md  folder=章纲",
    )
  })

  it("builds tool result with folder-first guidance and optional target chapter", () => {
    const result = buildOutlineListToolResult(
      [
        {
          relativePath: "章纲/第52章-条件.md",
          absolutePath: "/o/章纲/第52章-条件.md",
          folder: "章纲",
        },
        {
          relativePath: "设定/写作通则.md",
          absolutePath: "/o/设定/写作通则.md",
          folder: "设定",
        },
        {
          relativePath: "卷纲/第三卷.md",
          absolutePath: "/o/卷纲/第三卷.md",
          folder: "卷纲",
          type: "outline",
          outlineType: "volume-outline",
        },
        {
          relativePath: "全局设定.md",
          absolutePath: "/o/全局设定.md",
          type: "overview",
        },
      ],
      167,
    )

    expect(result).toContain("1. 章纲/第52章-条件.md  folder=章纲")
    expect(result).toContain("2. 设定/写作通则.md  folder=设定")
    expect(result).toContain("3. 卷纲/第三卷.md  folder=卷纲  type=outline  outline_type=volume-outline")
    expect(result).toContain("4. 全局设定.md  type=overview")
    expect(result).toContain("本次目标章号：第 167 章")
    expect(result).toContain("优先按文件夹（folder）分流")
    expect(result).toContain("章纲：本章主候选")
    expect(result).toContain("设定：全书硬约束")
    expect(result).toContain("旧兼容：overview≈大纲")
    expect(result).toContain("优先在章纲中定位")
  })
})

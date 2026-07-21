import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const writerFiles = [
  "../../components/layout/sidebar-panel.tsx",
  "../../components/novel/outline-editor.tsx",
  "outline-generation.ts",
  "outline-import.ts",
  "source-outline-import.ts",
]

describe("所有大纲创建入口使用纯 Markdown", () => {
  it.each(writerFiles)("%s 不再拼接大纲 YAML", (relativePath) => {
    const source = readFileSync(resolve(__dirname, relativePath), "utf8")

    expect(source).toContain("buildPureOutlineMarkdown")
    expect(source).not.toMatch(/["'`]type:\s*outline["'`]/)
    expect(source).not.toMatch(/["'`]outline_type:/)
  })
})

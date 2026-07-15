import { readFileSync } from "node:fs"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sourcesViewSource = readFileSync(resolve(__dirname, "sources-view.tsx"), "utf8")
const toolbarSource = readFileSync(resolve(__dirname, "outline-action-toolbar.tsx"), "utf8")
const promptTemplatesSource = readFileSync(resolve(__dirname, "../../lib/novel/prompt-templates.ts"), "utf8")
const sidebarPanelSource = readFileSync(resolve(__dirname, "../layout/sidebar-panel.tsx"), "utf8")

describe("AI 大纲工作台页面接入", () => {
  it("小说模式的大纲页面接入三栏工作台", () => {
    expect(sourcesViewSource).toContain("OutlineWorkbench")
    expect(sourcesViewSource).toContain("<OutlineWorkbench />")
  })

  it("大纲文件树接入左侧大纲侧栏而不是主内容区", () => {
    expect(sidebarPanelSource).toContain('activeView === "sources"')
    expect(sidebarPanelSource).toContain('setMode("files")')
    expect(sidebarPanelSource).toContain("<KnowledgeTree")
    expect(sidebarPanelSource).toContain('filterType={isChapter ? "chapter" : "outline"}')
    expect(readFileSync(resolve(__dirname, "outline-workbench.tsx"), "utf8")).not.toContain("OutlineFileTree")
    expect(readFileSync(resolve(__dirname, "outline-workbench.tsx"), "utf8")).not.toContain("outline-tree-pane")
  })

  it("大纲工具栏不再暴露旧的非对话式生成和细化弹窗", () => {
    expect(toolbarSource).not.toContain("OutlineGeneratorDialog")
    expect(toolbarSource).not.toContain("openOutlineDialog")
    expect(toolbarSource).not.toContain('mode="outline"')
    expect(toolbarSource).not.toContain('mode="refine"')
  })

  it("移除旧的非对话式生成界面且不把独立生成模块接回工作台", () => {
    expect(existsSync(resolve(__dirname, "outline-generator-dialog.tsx"))).toBe(false)
    expect(existsSync(resolve(__dirname, "../../lib/novel/outline-generation.ts"))).toBe(true)
    expect(existsSync(resolve(__dirname, "../../lib/novel/deep-outline-generation.ts"))).toBe(true)
    expect(sourcesViewSource).not.toContain("runDeepOutlineGeneration")
    expect(toolbarSource).not.toContain("runDeepOutlineGeneration")
    expect(promptTemplatesSource).toContain("outlineGeneration:")
    expect(promptTemplatesSource).not.toContain("outlineRefinementGeneration:")
  })
})

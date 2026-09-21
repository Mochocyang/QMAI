import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("图谱区域中文界面", () => {
  it("详情面板与预览兜底文案使用中文", () => {
    const frontmatterPanel = read("../components/editor/frontmatter-panel.tsx")
    const filePreview = read("../components/editor/file-preview.tsx")

    expect(frontmatterPanel).toContain("来源")
    expect(frontmatterPanel).toContain("资料")
    expect(frontmatterPanel).toContain("关联")
    expect(frontmatterPanel).toContain("更多")
    expect(frontmatterPanel).not.toContain('>Origin: </span>')
    expect(frontmatterPanel).not.toContain('\n            Sources\n')
    expect(frontmatterPanel).not.toContain('\n            Related\n')
    expect(frontmatterPanel).not.toContain('>More</div>')

    expect(filePreview).toContain("暂不支持预览该类型文件")
    expect(filePreview).not.toContain("Preview not available for this file type")
  })

  it("图谱文档编辑入口位于节点文档内部而不是顶部集中按钮区", () => {
    const graphView = read("../components/graph/graph-view.tsx")

    expect(graphView).toContain("editProfileInline")
    expect(graphView).toContain("saveProfileInline")
    expect(graphView).toContain("cancelProfileInline")
    expect(graphView).toContain("profilePath")
    expect(graphView).toContain("graph-doc-node-")
    expect(graphView).toContain("scrollIntoView")
    expect(graphView).not.toContain("graph.documentEditTitle")
    expect(graphView).not.toContain("graph.documentEditButton")
  })
})

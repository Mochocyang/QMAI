import { describe, expect, it } from "vitest"
import type { GraphNode } from "./wiki-graph"
import { buildEditableGraphNodePage } from "./graph-node-page"

const node: GraphNode = {
  id: "lin-mo",
  label: "林默",
  type: "character",
  path: "",
  linkCount: 2,
  community: 0,
}

describe("图谱节点档案页", () => {
  it("为没有真实路径的节点生成实体页路径和默认内容", () => {
    const page = buildEditableGraphNodePage("/project", node)

    expect(page.path).toBe("/project/wiki/entities/林默.md")
    expect(page.pageId).toBe("林默")
    expect(page.title).toBe("林默")
    expect(page.content).toContain("# 林默")
    expect(page.content).toContain("tags: [character]")
    expect(page.content).toContain("## 基础信息")
    expect(page.content).toContain("## 事件记录")
    expect(page.content).toContain("## 人物关系")
    expect(page.content).toContain("## 补充设定")
  })

  it("优先使用节点已有真实路径", () => {
    const page = buildEditableGraphNodePage("/project", {
      ...node,
      path: "/project/wiki/entities/已有.md",
      label: "已有",
    })

    expect(page.path).toBe("/project/wiki/entities/已有.md")
    expect(page.pageId).toBe("已有")
  })
})

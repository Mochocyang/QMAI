import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildWikiGraph } from "./wiki-graph"
import { listDirectory, readFile } from "@/commands/fs"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("./graph-relevance", () => ({
  buildRetrievalGraph: vi.fn().mockResolvedValue(null),
  calculateRelevance: vi.fn(() => 1),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({ dataVersion: 1 }),
  },
}))

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

describe("buildWikiGraph related frontmatter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("将 frontmatter related 字段解析为图谱边并与正文链接去重", async () => {
    mockListDirectory.mockResolvedValue([
      { name: "林默.md", path: "E:/project/wiki/林默.md", is_dir: false },
      { name: "092区域.md", path: "E:/project/wiki/092区域.md", is_dir: false },
      { name: "A3.md", path: "E:/project/wiki/A3.md", is_dir: false },
      { name: "孤立节点.md", path: "E:/project/wiki/孤立节点.md", is_dir: false },
    ])
    mockReadFile.mockImplementation(async (path) => {
      if (path.endsWith("林默.md")) {
        return `---
title: 林默
type: character
related: [092区域, A3, 不存在节点]
---
# 林默
他前往 [[092区域]]。`
      }
      if (path.endsWith("092区域.md")) return `---
title: 092区域
type: location
---
# 092区域`
      if (path.endsWith("A3.md")) return `---
title: A3
type: object
---
# A3`
      return `---
title: 孤立节点
type: event
---
# 孤立节点`
    })

    const graph = await buildWikiGraph("E:/project")
    const edgeKeys = graph.edges.map((edge) => `${edge.source}->${edge.target}`).sort()

    expect(edgeKeys).toEqual(["林默->092区域", "林默->A3"])
    expect(graph.nodes.find((node) => node.id === "林默")?.linkCount).toBe(2)
  })

  it("将同一章节快照来源的孤立小说节点补连到章节节点", async () => {
    mockListDirectory.mockResolvedValue([
      { name: "第1章.md", path: "E:/project/wiki/entities/第1章.md", is_dir: false },
      { name: "黑雨夜失踪.md", path: "E:/project/wiki/entities/黑雨夜失踪.md", is_dir: false },
      { name: "杨妙萍.md", path: "E:/project/wiki/entities/杨妙萍.md", is_dir: false },
    ])
    mockReadFile.mockImplementation(async (path) => {
      if (path.endsWith("第1章.md")) return `---
title: 第1章
type: entity
tags: [chapter]
sources: ["001.snapshot.json"]
---
# 第1章`
      if (path.endsWith("黑雨夜失踪.md")) return `---
title: 黑雨夜失踪
type: entity
tags: [event]
sources: ["001.snapshot.json"]
---
# 黑雨夜失踪`
      return `---
title: 杨妙萍
type: entity
tags: [character]
sources: ["001.snapshot.json"]
related: [第1章]
---
# 杨妙萍`
    })

    const graph = await buildWikiGraph("E:/project")
    const edgeKeys = graph.edges.map((edge) => `${edge.source}->${edge.target}`).sort()
    const snapshotEdge = graph.edges.find((edge) => edge.source === "黑雨夜失踪" && edge.target === "第1章")

    expect(edgeKeys).toContain("黑雨夜失踪->第1章")
    expect(snapshotEdge?.relation).toBe("APPEARS_IN")
    expect(snapshotEdge?.sources).toEqual(["001.snapshot.json"])
    expect(graph.nodes.find((node) => node.id === "黑雨夜失踪")?.sources).toEqual(["001.snapshot.json"])
    expect(graph.nodes.find((node) => node.id === "黑雨夜失踪")?.linkCount).toBeGreaterThan(0)
  })

  it("从 Wiki 条目关系行派生具体关系边并保留条目来源", async () => {
    mockListDirectory.mockResolvedValue([
      { name: "林默.md", path: "E:/project/wiki/entities/林默.md", is_dir: false },
      { name: "陆沉舟.md", path: "E:/project/wiki/entities/陆沉舟.md", is_dir: false },
      { name: "黑雨夜.md", path: "E:/project/wiki/entities/黑雨夜.md", is_dir: false },
    ])
    mockReadFile.mockImplementation(async (path) => {
      if (path.endsWith("林默.md")) return `---
title: 林默
type: entity
tags: [character]
sources: ["wiki/entities/林默.md", "001.snapshot.json"]
---
# 林默

- [[陆沉舟]] — 敌对
- [[黑雨夜]] — 影响`
      if (path.endsWith("陆沉舟.md")) return `---
title: 陆沉舟
type: entity
tags: [character]
sources: ["wiki/entities/陆沉舟.md"]
---
# 陆沉舟`
      return `---
title: 黑雨夜
type: entity
tags: [event]
sources: ["001.snapshot.json"]
---
# 黑雨夜`
    })

    const graph = await buildWikiGraph("E:/project")
    const enemyEdge = graph.edges.find((edge) => edge.source === "林默" && edge.target === "陆沉舟")
    const affectEdge = graph.edges.find((edge) => edge.source === "林默" && edge.target === "黑雨夜")

    expect(enemyEdge?.relation).toBe("ENEMY_OF")
    expect(enemyEdge?.sources).toEqual(["wiki/entities/林默.md", "001.snapshot.json"])
    expect(affectEdge?.relation).toBe("AFFECTS")
    expect(affectEdge?.sources).toEqual(["wiki/entities/林默.md", "001.snapshot.json"])
  })

  it("保留同一对节点的不同关系和反向关系并追溯来源", async () => {
    mockListDirectory.mockResolvedValue([
      { name: "林默.md", path: "E:/project/wiki/entities/林默.md", is_dir: false },
      { name: "陆沉舟.md", path: "E:/project/wiki/entities/陆沉舟.md", is_dir: false },
    ])
    mockReadFile.mockImplementation(async (path) => {
      if (path.endsWith("林默.md")) return `---
title: 林默
type: entity
tags: [character]
sources: ["001.snapshot.json"]
---
# 林默

- [[陆沉舟]] — 敌对
- [[陆沉舟]] — 怀疑`
      return `---
title: 陆沉舟
type: entity
tags: [character]
sources: ["002.snapshot.json"]
---
# 陆沉舟

- [[林默]] — 隐瞒`
    })

    const graph = await buildWikiGraph("E:/project")
    const relationKeys = graph.edges
      .map((edge) => `${edge.source}->${edge.target}:${edge.relation}:${edge.sources?.join(",")}`)
      .sort()

    expect(relationKeys).toEqual([
      "林默->陆沉舟:ENEMY_OF:001.snapshot.json",
      "林默->陆沉舟:SUSPECTS:001.snapshot.json",
      "陆沉舟->林默:HIDES_FROM:002.snapshot.json",
    ])
  })
})

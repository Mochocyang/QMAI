import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * 与 knowledge-tree.delete-menu.spec.tsx 同一做法：
 * 组件依赖 store 和 Tauri，这里只断言菜单入口接到了重新扫描目录的函数上。
 */
const source = readFileSync(resolve(__dirname, "knowledge-tree.tsx"), "utf8")

function menuBlock(marker: string): string {
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf("{pageMenu && (", start + marker.length)
  return source.slice(start, end === -1 ? undefined : end)
}

describe("章节列表右键菜单的刷新目录", () => {
  it("空白处和章节行的右键菜单都有「刷新目录」，并且只在章节列表出现", () => {
    const blankMenu = menuBlock("{createMenu && (")
    const pageMenu = source.slice(source.indexOf("{pageMenu && ("))
    for (const block of [blankMenu, pageMenu]) {
      const buttonStart = block.indexOf('data-ui="tree-refresh-directory"')
      expect(buttonStart).toBeGreaterThan(-1)
      const gatedStart = block.lastIndexOf('{filterType === "chapter"', buttonStart)
      expect(gatedStart).toBeGreaterThan(-1)
      expect(block.slice(gatedStart, block.indexOf("</button>", buttonStart))).toContain("刷新目录")
      expect(block.slice(gatedStart, block.indexOf("</button>", buttonStart))).toContain("handleRefreshDirectory()")
    }
  })

  it("刷新目录会重新读取页面并重扫项目文件树", () => {
    const handlerStart = source.indexOf("const handleRefreshDirectory")
    expect(handlerStart).toBeGreaterThan(-1)
    const handler = source.slice(handlerStart, source.indexOf("const handleMovePagesToFolder", handlerStart))
    expect(handler).toContain("await refreshCurrentTree()")
    const refreshStart = source.indexOf("const refreshCurrentTree")
    const refresh = source.slice(refreshStart, handlerStart)
    expect(refresh).toContain("await loadPages()")
    expect(refresh).toContain("await listDirectory(normalizePath(project.path))")
    expect(refresh).toContain("setFileTree(tree)")
    expect(refresh).toContain("bumpDataVersion()")
  })
})

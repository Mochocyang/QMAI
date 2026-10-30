import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * knowledge-tree.tsx 是个两千四百行、依赖一堆 store / Tauri 命令的大组件，
 * mount 一次的代价远大于这里要断言的「菜单入口是否接上了线」。
 * 与 knowledge-tree.spec.tsx 保持一致：读源码字符串做结构断言。
 */
const source = readFileSync(resolve(__dirname, "knowledge-tree.tsx"), "utf8")

describe("章节/大纲右键菜单的历史版本入口", () => {
  it("菜单里有「历史版本」，且文案不是「查看历史版本」", () => {
    expect(source).toContain("历史版本")
    expect(source).not.toContain("查看历史版本")
  })

  it("「历史版本」菜单项紧跟在「重命名」之后", () => {
    /*
     * 文档菜单里的「重命名」是唯一一处 onClick 里调 startRenamePage 的 rename 项
     * （文件夹创建菜单里那句同名文案不带 startRenamePage）。
     *
     * 定位方式刻意不写死缩进或换行符：源文件是 CRLF、缩进有人动过，
     * 之前写死 "\r\n" + 精确缩进的做法一次重排就会假失败。
     * 改为「按关键行逐步定位」，只依赖真正有语义的代码本身。
     */
    const historyIndex = source.indexOf('data-ui="tree-version-history"')
    expect(historyIndex).toBeGreaterThan(-1)

    // 重命名那一项：从 onClick 里出现 startRenamePage 的位置往前找它所属的 <button
    const renameCall = source.indexOf("if (target) startRenamePage(target)")
    expect(renameCall).toBeGreaterThan(-1)
    const renameTagStart = source.lastIndexOf("<button", renameCall)
    expect(renameTagStart).toBeGreaterThan(-1)
    // 取「重命名」按钮自己的收口：从 startRenamePage 往后找的第一个 </button> 就是它
    const renameTagEnd = source.indexOf("</button>", renameCall) + "</button>".length
    expect(renameTagEnd).toBeGreaterThan(renameCall)
    // 确认这一段确实是「重命名」项，而不是别的按钮
    expect(source.slice(renameTagStart, renameTagEnd)).toContain('{t("knowledgeTree.rename")}')

    // 历史版本必须排在重命名之后
    const historyTagStart = source.lastIndexOf("<button", historyIndex)
    expect(historyTagStart).toBeGreaterThan(renameTagEnd)

    // 两者之间不能再夹任何菜单项按钮 —— 只能有换行与缩进
    const between = source.slice(renameTagEnd, historyTagStart)
    expect(between).not.toContain("<button")
    expect(between).not.toContain("</button>")
    expect(between.trim()).toBe("")

    // 顺带确认「历史版本」这串字就在它自己的按钮里。
    expect(source.slice(historyTagStart, source.indexOf("</button>", historyIndex))).toContain("历史版本")
  })

  it("章节用编号、大纲用文件名当版本 key", () => {
    expect(source).toContain('const kind = filterType === "chapter" ? "chapter" : "outline"')
    expect(source).toContain("page?.chapterNumber ?? page?.fileChapterNumber ?? null")
  })

  it("恢复版本前会先把当前内容存成一条历史（恢复可撤销）", () => {
    const restoreBlock = source.slice(source.indexOf("const restoreVersion"))
    expect(restoreBlock).toContain("await saveVersion({")
    expect(restoreBlock).toContain("content: historyCurrent")
    // 顺序：先 saveVersion 再 writeFile
    expect(restoreBlock.indexOf("await saveVersion")).toBeLessThan(restoreBlock.indexOf("await writeFile"))
  })

  it("弹窗通过 VersionHistoryDialog 渲染", () => {
    expect(source).toContain("<VersionHistoryDialog")
    expect(source).toContain("onRestore={(version) =>")
  })
})

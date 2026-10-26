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
    // 文档菜单里「重命名」是唯一一处带 startRenamePage 的 rename 文案；
    // 直接 indexOf 会先命中文件夹创建菜单里的同名文案，所以用完整代码块定位。
    // 仓库里的源文件是 CRLF，标记按行拼装，避免写死的 "\n" 匹配不到。
    const renameMarker = [
      "if (target) startRenamePage(target)",
      "              }}",
      "            >",
      '              <Pencil className="h-3.5 w-3.5" />',
      '              {t("knowledgeTree.rename")}',
      "            </button>",
    ].join("\r\n")
    const renameIndex = source.indexOf(renameMarker)
    const historyIndex = source.indexOf('data-ui="tree-version-history"')
    expect(renameIndex).toBeGreaterThan(-1)
    expect(historyIndex).toBeGreaterThan(renameIndex)
    // 从重命名按钮的收口处（`</button>` 之后）开始截，只到「历史版本」按钮的起始标签为止：
    // 中间必须只剩下换行和缩进——连一个 <button / </button> 都不能有，
    // 否则就说明有别的菜单项插在了两者之间。
    const afterRename = renameIndex + renameMarker.length
    const historyTagStart = source.lastIndexOf("<button", historyIndex)
    const between = source.slice(afterRename, historyTagStart)
    expect(between).not.toContain("<button")
    expect(between).not.toContain("</button>")
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

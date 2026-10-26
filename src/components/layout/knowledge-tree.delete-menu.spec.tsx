import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * knowledge-tree.tsx 是个两千多行、依赖一堆 store / Tauri 命令的大组件，mount 代价太高，
 * 与 knowledge-tree.spec.tsx / knowledge-tree.version-menu.spec.tsx 保持一致：
 * 读源码字符串做结构断言。
 *
 * 注意 ui-test.css 的路径：样式表实际在 src/components/uitest/ 下，
 * 不在本目录（任务描述里写的是 src/components/layout/ui-test.css，那条路径不存在）。
 */
const source = readFileSync(resolve(__dirname, "knowledge-tree.tsx"), "utf8")
const css = readFileSync(resolve(__dirname, "../uitest/ui-test.css"), "utf8")

describe("行内删除按钮已移除，改为右键删除 + 红色二次确认", () => {
  it("行内不再渲染 DeleteButton，组件本身也已删除", () => {
    expect(source).not.toContain("<DeleteButton")
    expect(source).not.toContain("function DeleteButton")
    // 状态用的 isArmed / armedPath 与类名是两回事：类名必须彻底消失
    expect(source).not.toContain("ui-test-tree-delete")
  })

  it("右键菜单里有「删除」，且是危险色", () => {
    expect(source).toContain('data-ui="tree-delete"')
    const idx = source.indexOf('data-ui="tree-delete"')
    const tagStart = source.lastIndexOf("<button", idx)
    const tagEnd = source.indexOf("</button>", idx)
    const block = source.slice(tagStart, tagEnd)
    expect(block).toContain("text-destructive")
    expect(block).toContain("删除")
  })

  it("二次确认条是红底白字（用户投诉过白底看不清）", () => {
    const idx = source.indexOf('data-ui="tree-delete-confirm"')
    expect(idx).toBeGreaterThan(-1)
    const tagStart = source.lastIndexOf("<button", idx)
    const tagEnd = source.indexOf(">", tagStart)
    const openTag = source.slice(tagStart, tagEnd)
    // 必须同时指定底色与字色，不能只靠 variant="destructive"（那是浅底）
    expect(openTag).toContain("bg-destructive")
    expect(openTag).toContain("text-white")
    expect(openTag).not.toContain('variant="destructive"')
  })

  it("删除仍然是两步确认：第一次只 arm，不直接删", () => {
    // handleDeleteClick 里保留了 armedPath 判定的分支
    expect(source).toContain("if (armedPath !== pagePath)")
    expect(source).toContain("setArmedPath(pagePath)")
  })

  it("CSS 里与行内删除按钮相关的规则已清理，但「更多操作」按钮的 hover 保留", () => {
    expect(css).not.toContain(".ui-test-tree-delete")
    expect(css).toContain(".ui-test-tree-more")
  })
})

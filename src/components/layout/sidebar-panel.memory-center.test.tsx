import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * 断言「源码里不再出现 X」之前必须先去掉注释 —— 解释移除原因的注释里
 * 会原样写上那些标识符，不去掉的话"自己的说明"会把检查喂饱。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}

const source = stripComments(readFileSync(resolve(__dirname, "sidebar-panel.tsx"), "utf8"))

/**
 * 侧栏与记忆中心的关系在单页重构后**反转**了。
 *
 * 原来这里钉的是"中间栏渲染记忆分类列表"（novelMode、loadMemoryCenterData、
 * MemoryCenterListButton、setSelectedMemoryCenterEntry）。现在那整块都不该存在，
 * 断言改成钉"侧栏确实不再插手记忆中心"，防止它被重新长回来。
 */
describe("sidebar-panel 不再承载记忆中心", () => {
  it("不再渲染记忆分类列表，也不再为它加载数据", () => {
    expect(source).not.toContain("MemoryCenterListButton")
    expect(source).not.toContain("loadMemoryCenterData")
    expect(source).not.toContain("setSelectedMemoryCenterEntry")
    expect(source).not.toContain("MEMORY_LABEL_KEYS")
    expect(source).not.toContain("MEMORY_ICONS")
  })

  it("不再读 novelMode（记忆中心分支是它唯一的消费者）", () => {
    expect(source).not.toContain("novelMode")
  })

  it("不再保留拆文库的过滤分支", () => {
    expect(source).not.toContain("dismantling-library")
  })

  it("章节树仍然不把 lint 当作 chapter 模式", () => {
    expect(source).not.toContain('activeView === "lint" ? "chapter" : "outline"')
  })

  /*
   * 导入章节时的「记忆提取」取消入口与记忆中心的**展示**无关，
   * 两者此前共用 memory 前缀。这条断言是为了防止有人顺着 grep "memory"
   * 把导入流程里的取消注册一起删掉。
   */
  it("导入记忆提取的取消入口仍在", () => {
    expect(source).toContain("handleCancelImportMemoryExtraction")
    expect(source).toContain("onUiTestRegisterCancel")
  })
})

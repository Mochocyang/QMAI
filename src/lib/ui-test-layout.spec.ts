import { describe, expect, it } from "vitest"
import { getUiTestPanelLayout, resizeUiTestAiByKey, filterUiTestDirectory, getUiTestDocumentPath } from "./ui-test-layout"

describe("测试版基于实际容器的布局", () => {
  it("桌面保留480正文，AI默认320，不突破容器", () => {
    expect(getUiTestPanelLayout(1140, 360, 1440)).toEqual({ mode: "split", aiWidth: 360, editorWidth: 768, maxAiWidth: 570 })
    const small = getUiTestPanelLayout(810, 560, 1200)
    expect(small.aiWidth).toBe(318)
    expect(small.editorWidth).toBe(480)
  })
  it("中等窗口正文至少360、AI至少280；空间不足用页签", () => {
    expect(getUiTestPanelLayout(710, 560, 900)).toMatchObject({ mode: "split", aiWidth: 338, editorWidth: 360 })
    expect(getUiTestPanelLayout(600, 560, 900)).toMatchObject({ mode: "tabs", aiWidth: 600, editorWidth: 600 })
    expect(getUiTestPanelLayout(720, 360, 767).mode).toBe("tabs")
  })
  it("AI最小280，最大为容器一半，异常偏好使用320", () => {
    expect(getUiTestPanelLayout(1200, 30, 1440).aiWidth).toBe(280)
    expect(getUiTestPanelLayout(1200, Infinity, 1440).aiWidth).toBe(320)
    expect(getUiTestPanelLayout(1200, 999, 1440).aiWidth).toBe(600)
    expect(getUiTestPanelLayout(1600, 999, 1800).aiWidth).toBe(800)
  })
  it("键盘拖柄16px步进、Home最小/End最大", () => {
    expect(resizeUiTestAiByKey(360, "ArrowLeft", 1200)).toBe(376)
    expect(resizeUiTestAiByKey(360, "ArrowRight", 1200)).toBe(344)
    expect(resizeUiTestAiByKey(360, "Home", 1200)).toBe(280)
    expect(resizeUiTestAiByKey(360, "End", 1200)).toBe(600)
    expect(resizeUiTestAiByKey(360, "Enter", 1200)).toBe(360)
  })
})

describe("目录筛选只改变可见树，不改变原树和业务排序", () => {
  const tree = [{ name: "第一卷", path: "/chapters/vol1", is_dir: true, children: [
    { name: "01.md", path: "/chapters/vol1/01.md", is_dir: false },
    { name: "02.md", path: "/chapters/vol1/02.md", is_dir: false },
  ] }]
  it("按真实标题查询时保留祖先目录，不修改输入", () => {
    const filtered = filterUiTestDirectory(tree, "雨停", new Map([["/chapters/vol1/02.md", "雨停之前"]]))
    expect(filtered[0]?.children?.map(n => n.name)).toEqual(["02.md"])
    expect(tree[0].children).toHaveLength(2)
  })
  it("匹配整个目录和空查询可看到全部内容，无结果为空", () => {
    expect(filterUiTestDirectory(tree, "第一卷", new Map())[0].children).toHaveLength(2)
    expect(filterUiTestDirectory(tree, "", new Map())).toBe(tree)
    expect(filterUiTestDirectory(tree, "不存在", new Map())).toEqual([])
  })
})

describe("测试版恢复文档不跨小说写入", () => {
  it("相对偏好跟随移动后的项目目录，绝对旧目录和其他书被拒绝", () => {
    expect(getUiTestDocumentPath("D:/QM-BOOK-UI-TEST/新位置", "wiki/chapters/01.md", "wiki")).toBe("D:/QM-BOOK-UI-TEST/新位置/wiki/chapters/01.md")
    expect(getUiTestDocumentPath("D:/QM-BOOK-UI-TEST/新位置", "C:/QM-BOOK/旧书/wiki/chapters/01.md", "wiki")).toBeNull()
    expect(getUiTestDocumentPath("D:/QM-BOOK-UI-TEST/新位置", "../其他书/wiki/chapters/01.md", "wiki")).toBeNull()
    expect(getUiTestDocumentPath("D:/QM-BOOK-UI-TEST/新位置", "wiki/outlines/outline.md", "wiki")).toBeNull()
    expect(getUiTestDocumentPath("D:/QM-BOOK-UI-TEST/新位置", 42 as unknown as string, "wiki")).toBeNull()
  })
})

/**
 * `targetAvailability` 的测试：这套判定同时决定「按钮禁用」与「tooltip 文案」，
 * 所以每条规则都要钉住 —— 判定写错一次，用户就会点到一个注定失败的按钮。
 */
import { describe, expect, it } from "vitest"
import { isWritableProjectField, sanitizeBookTitle, targetAvailability } from "./targets"

const noEditorNoProject = { hasEditor: false, hasProject: false }
const editorAndProject = { hasEditor: true, hasProject: true }

describe("targetAvailability", () => {
  it("clipboard 永远可用（宿主永远能复制）", () => {
    expect(targetAvailability({ kind: "clipboard", label: "复制" }, noEditorNoProject)).toEqual({ enabled: true })
    expect(targetAvailability({ kind: "clipboard", label: "复制" }, editorAndProject)).toEqual({ enabled: true })
  })

  it("bookTitle：有项目时可用，没项目时禁用并说明原因", () => {
    const target = { kind: "project-field" as const, field: "bookTitle", label: "设为书名" }
    expect(targetAvailability(target, { hasEditor: false, hasProject: true })).toEqual({ enabled: true })
    const blocked = targetAvailability(target, noEditorNoProject)
    expect(blocked.enabled).toBe(false)
    expect(blocked.reason).toContain("还没有打开项目")
  })

  it("其它 project-field 恒禁用，理由指明缺的是写入通道", () => {
    for (const field of ["bookIntro", "protagonist", "setting", "bookTags", undefined]) {
      const result = targetAvailability({ kind: "project-field", field, label: "写入" }, editorAndProject)
      expect(result.enabled).toBe(false)
      expect(result.reason).toContain("宿主还没有该字段的写入通道")
    }
  })

  it("insert-at-cursor 依赖 hasEditor；有编辑器但宿主没有插入通道时也禁用", () => {
    const target = { kind: "insert-at-cursor" as const, label: "插入到光标处" }

    const noEditor = targetAvailability(target, { hasEditor: false, hasProject: true })
    expect(noEditor.enabled).toBe(false)
    expect(noEditor.reason).toContain("章节编辑器")

    // 有编辑器、但编辑器没有插入 API（宿主当前就是这个状态）
    const noChannel = targetAvailability(target, { hasEditor: true, hasProject: true })
    expect(noChannel.enabled).toBe(false)
    expect(noChannel.reason).toContain("插入通道")

    expect(targetAvailability(target, { hasEditor: true, hasProject: true, editorCanInsert: true })).toEqual({
      enabled: true,
    })
  })

  it("chapter-note 恒禁用（宿主没有章节备注存储）", () => {
    const result = targetAvailability({ kind: "chapter-note", label: "追加到章节备注" }, editorAndProject)
    expect(result.enabled).toBe(false)
    expect(result.reason).toContain("章节备注")
  })

  it("run-action 不是写回目标，禁用并指向灵感库", () => {
    const result = targetAvailability(
      { kind: "run-action", actionId: "expand", label: "让 AI 扩写" },
      editorAndProject,
    )
    expect(result.enabled).toBe(false)
    expect(result.reason).toContain("灵感库")
  })
})

describe("isWritableProjectField", () => {
  it("只有 bookTitle 有真实写入通道", () => {
    expect(isWritableProjectField("bookTitle")).toBe(true)
    expect(isWritableProjectField("bookIntro")).toBe(false)
    expect(isWritableProjectField(undefined)).toBe(false)
  })
})

describe("sanitizeBookTitle（书名会变成目录名）", () => {
  it("取第一行非空内容并去掉书名包装", () => {
    expect(sanitizeBookTitle("《长夜》")).toBe("长夜")
    expect(sanitizeBookTitle("\n\n「归途」\n第二行")).toBe("归途")
    expect(sanitizeBookTitle("  长夜  ")).toBe("长夜")
  })

  it("挡掉路径分隔符与 Windows 非法字符", () => {
    expect(sanitizeBookTitle("长夜/归途")).toBe("长夜 归途")
    expect(sanitizeBookTitle('长夜:第?*"一"部')).toBe("长夜 第 一 部")
    expect(sanitizeBookTitle("a\\b")).toBe("a b")
  })

  it("空输入返回空串（调用方据此报错，而不是写一个空目录名）", () => {
    expect(sanitizeBookTitle("")).toBe("")
    expect(sanitizeBookTitle("   \n  \n")).toBe("")
    expect(sanitizeBookTitle("《》")).toBe("")
  })
})

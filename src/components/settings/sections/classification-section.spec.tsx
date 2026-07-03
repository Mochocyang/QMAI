import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const classificationSectionPath = resolve(__dirname, "classification-section.tsx")
const modifyConfirmDialogPath = resolve(__dirname, "../../chat/modify-confirm-dialog.tsx")

describe("ClassificationSection 编辑入口", () => {
  it("valid 状态下提供 classification.md textarea 编辑区", () => {
    expect(existsSync(classificationSectionPath)).toBe(true)
    const source = readFileSync(classificationSectionPath, "utf8")

    expect(source).toContain("readProjectClassificationRaw")
    expect(source).toContain("editingContent")
    expect(source).toContain("textarea")
    expect(source).toContain("classification.md")
  })

  it("保存前解析 markdown，格式错误时不写入", () => {
    const source = readFileSync(classificationSectionPath, "utf8")

    expect(source).toContain("deserializeClassificationFromMarkdown(editingContent)")
    expect(source).toContain("classification.saveInvalid")
    expect(source).toContain("writeProjectClassification(pp, parsed)")
  })

  it("恢复默认通过确认对话框写入 DEFAULT_CLASSIFICATION_CONFIG", () => {
    const source = readFileSync(classificationSectionPath, "utf8")

    expect(source).toContain("ModifyConfirmDialog")
    expect(source).toContain('type="classification"')
    expect(source).toContain("DEFAULT_CLASSIFICATION_CONFIG")
    expect(source).toContain("确认恢复默认配置")
  })

  it("ModifyConfirmDialog 支持 classification 类型文案", () => {
    const source = readFileSync(modifyConfirmDialogPath, "utf8")

    expect(source).toContain('"classification"')
    expect(source).toContain("确认恢复 classification.md")
    expect(source).toContain("当前配置")
    expect(source).toContain("默认配置")
  })
})

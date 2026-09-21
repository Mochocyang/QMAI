import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "create-project-dialog.tsx"), "utf8")

describe("新建小说项目弹窗", () => {
  it("支持表单回车直接创建", () => {
    expect(source).toContain("<form")
    expect(source).toContain('type="submit"')
    expect(source).toContain("event.preventDefault()")
  })

  it("创建前会自动补齐默认目录并创建父目录", () => {
    expect(source).toContain("resolveDefaultParentDir")
    expect(source).toContain("await createDirectory(parentDir)")
    expect(source).toContain("path.trim() || await resolveDefaultParentDir()")
  })
})

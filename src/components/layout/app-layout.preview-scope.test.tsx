import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "app-layout.tsx"), "utf8")

describe("非章节视图不显示右侧正文预览", () => {
  it("关闭 secondary preview panel", () => {
    expect(source).not.toContain('import { PreviewPanel } from "./preview-panel"')
    expect(source).toContain("<ContentArea />")
  })
})

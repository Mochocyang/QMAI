import { describe, expect, it } from "vitest"
import {
  DOCUMENT_APPEARANCE_STYLE_ID,
  applyDocumentAppearance,
} from "./html-document-appearance"

const SOURCE = "<!DOCTYPE html><html><head><style>.chip{background:#fff}</style></head><body>折叠树</body></html>"

function styleCount(html: string): number {
  return html.match(new RegExp(`id="${DOCUMENT_APPEARANCE_STYLE_ID}"`, "g"))?.length ?? 0
}

describe("applyDocumentAppearance", () => {
  it("按静水、纸间、星夜写入对应纸底、墨色和强调色", () => {
    const jing = applyDocumentAppearance(SOURCE, "jing")
    expect(jing).toContain("#fcfdfb")
    expect(jing).toContain("#273c35")
    expect(jing).toContain("#45624f")
    expect(jing).toContain("color-scheme:light")

    const zhi = applyDocumentAppearance(SOURCE, "zhi")
    expect(zhi).toContain("#fffcf7")
    expect(zhi).toContain("#423d31")
    expect(zhi).toContain("#655a42")
    expect(zhi).toContain("color-scheme:light")

    const xing = applyDocumentAppearance(SOURCE, "xing")
    expect(xing).toContain("#222f2a")
    expect(xing).toContain("#e6eee7")
    expect(xing).toContain("#b0c9ae")
    expect(xing).toContain("color-scheme:dark")
    expect(xing).not.toContain("#F4EEE8")
    expect(xing).toContain("#2a3832")
  })

  it("注入盖住旧文档的白底，并只保留一段样式", () => {
    const once = applyDocumentAppearance(SOURCE, "xing")
    expect(once).toContain("折叠树")
    expect(once).toContain(".chip{background:#fff}")
    expect(once.indexOf(DOCUMENT_APPEARANCE_STYLE_ID)).toBeGreaterThan(once.indexOf(".chip{background:#fff}"))
    expect(once).toContain('.bt[data-b="顶"]')
    expect(styleCount(once)).toBe(1)

    const twice = applyDocumentAppearance(once, "zhi")
    expect(styleCount(twice)).toBe(1)
    expect(twice).toContain("#fffcf7")
    expect(twice).not.toContain("#222f2a")
    expect(twice).toContain("折叠树")
  })

  it("不修改入参，没有 head 时也能注入", () => {
    const snapshot = SOURCE.slice()
    applyDocumentAppearance(SOURCE, "xing")
    expect(SOURCE).toBe(snapshot)

    const bare = applyDocumentAppearance("<p>正文</p>", "jing")
    expect(bare.startsWith("<head><style")).toBe(true)
    expect(bare).toContain("#fcfdfb")
    expect(bare).toContain("<p>正文</p>")
    expect(styleCount(bare)).toBe(1)
  })
})

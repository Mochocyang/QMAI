import { describe, expect, it } from "vitest"
import {
  buildVersionDir,
  buildVersionFileName,
  shortHash,
  parseVersionFileName,
} from "./version-store"

describe("版本文件名", () => {
  it("短哈希取 4 位，稳定可复现", () => {
    expect(shortHash("hello")).toBe(shortHash("hello"))
    expect(shortHash("hello")).toHaveLength(4)
    expect(shortHash("hello")).not.toBe(shortHash("hello!"))
  })

  it("文件名带时间戳和哈希，同秒两次保存不会互相覆盖", () => {
    const at = new Date(2026, 9, 26, 9, 0, 0) // 本地时间 2026-10-26 09:00:00
    const a = buildVersionFileName(at, "内容一")
    const b = buildVersionFileName(at, "内容二")
    expect(a).toMatch(/^20261026-090000-[0-9a-f]{4}\.md$/)
    expect(a).not.toBe(b)
  })

  it("能从文件名反解出时间", () => {
    const parsed = parseVersionFileName("20261026-090000-1c4d.md")
    expect(parsed).not.toBeNull()
    expect(parsed!.hash).toBe("1c4d")
    expect(parsed!.at.getFullYear()).toBe(2026)
    expect(parsed!.at.getMonth()).toBe(9) // 10 月
    expect(parsed!.at.getDate()).toBe(26)
    expect(parsed!.at.getHours()).toBe(9)
    expect(parsed!.at.getMinutes()).toBe(0)
  })

  it("不认识的乱文件名返回 null，不让界面崩", () => {
    expect(parseVersionFileName("README.md")).toBeNull()
    expect(parseVersionFileName("20261026-090000.md")).toBeNull()
    expect(parseVersionFileName("20261026-090000-zzzz.md")).toBeNull()
  })

  it("章节目录按编号补零；大纲目录用文件名并阻止越界", () => {
    expect(buildVersionDir("/书", "chapter", 7)).toBe("/书/.qmai/versions/chapters/007")
    expect(buildVersionDir("/书", "chapter", null)).toBe("/书/.qmai/versions/chapters/unnumbered")
    expect(buildVersionDir("/书", "outline", "总纲")).toBe("/书/.qmai/versions/outlines/总纲")
    // 路径分隔符必须被替换掉，否则会跳出版本库目录
    expect(buildVersionDir("/书", "outline", "../逃逸")).not.toContain("../")
  })
})

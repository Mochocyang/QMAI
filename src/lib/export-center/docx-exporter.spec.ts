// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { serializeDocx } from "./docx-exporter"
import type { ExportDocument } from "./types"

function readStoredZipEntries(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const entries = new Map<string, string>()
  let offset = 0
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength))
    entries.set(name, decoder.decode(bytes.slice(dataStart, dataStart + compressedSize)))
    offset = dataStart + compressedSize
  }
  return entries
}

const document: ExportDocument = {
  title: "山河故人",
  source: "chapters",
  blocks: [
    { title: "第一章", paragraphs: ["中文正文", "A < B & C"] },
    { title: "第二章", paragraphs: ["结尾"] },
  ],
}

describe("DOCX 导出器", () => {
  it("生成包含 Office Open XML 必需文件的 ZIP 包", () => {
    const bytes = serializeDocx(document)
    const entries = readStoredZipEntries(bytes)

    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b])
    expect(entries.has("[Content_Types].xml")).toBe(true)
    expect(entries.has("_rels/.rels")).toBe(true)
    expect(entries.has("word/document.xml")).toBe(true)
  })

  it("过滤 XML 1.0 禁止控制字符且生成的 document.xml 可由 DOMParser 解析", () => {
    const withControls: ExportDocument = {
      title: "控制字符\u0001标题",
      source: "chapters",
      blocks: [{ title: "正文\u000b", paragraphs: ["保留制表符\t换行\n回车\r，删除\u0008\u000c\u001f"] }],
    }
    const xml = readStoredZipEntries(serializeDocx(withControls)).get("word/document.xml") ?? ""
    const parsed = new DOMParser().parseFromString(xml, "application/xml")

    expect(xml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
    expect(xml).toContain("保留制表符\t换行\n回车\r，删除")
    expect(parsed.querySelector("parsererror")).toBeNull()
  })

  it("在 document.xml 中按顺序保留标题、中文和独立段落", () => {
    const xml = readStoredZipEntries(serializeDocx(document)).get("word/document.xml") ?? ""

    expect(xml).toContain("山河故人")
    expect(xml).toContain("第一章")
    expect(xml).toContain("中文正文")
    expect(xml).toContain("A &lt; B &amp; C")
    expect(xml.indexOf("第一章")).toBeLessThan(xml.indexOf("第二章"))
    expect((xml.match(/<w:p>/g) ?? []).length).toBe(7)
  })
})

it("中央目录记录与本地文件数据一致，可被标准 ZIP 读取器定位", () => {
  const bytes = serializeDocx(document)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let centralOffset = -1
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      centralOffset = offset
      break
    }
  }

  expect(centralOffset).toBeGreaterThan(0)
  const localOffset = view.getUint32(centralOffset + 42, true)
  expect(view.getUint32(localOffset, true)).toBe(0x04034b50)
  expect(view.getUint32(centralOffset + 16, true)).toBe(view.getUint32(localOffset + 14, true))
  expect(view.getUint32(centralOffset + 20, true)).toBe(view.getUint32(localOffset + 18, true))
  expect(view.getUint32(centralOffset + 24, true)).toBe(view.getUint32(localOffset + 22, true))
})

import type { ExportDocument } from "./types"

interface ZipEntry {
  name: Uint8Array
  data: Uint8Array
  crc: number
  offset: number
}

const encoder = new TextEncoder()

function xmlEscape(value: string): string {
  const xml10 = Array.from(value).filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint === 0x09
      || codePoint === 0x0a
      || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  }).join("")
  return xml10
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function localHeader(entry: ZipEntry): Uint8Array {
  const header = new Uint8Array(30)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 0x0800, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0x21, true)
  view.setUint32(14, entry.crc, true)
  view.setUint32(18, entry.data.length, true)
  view.setUint32(22, entry.data.length, true)
  view.setUint16(26, entry.name.length, true)
  return concat([header, entry.name, entry.data])
}

function centralHeader(entry: ZipEntry): Uint8Array {
  const header = new Uint8Array(46)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, 0x0800, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0, true)
  view.setUint16(14, 0x21, true)
  view.setUint32(16, entry.crc, true)
  view.setUint32(20, entry.data.length, true)
  view.setUint32(24, entry.data.length, true)
  view.setUint16(28, entry.name.length, true)
  view.setUint32(42, entry.offset, true)
  return concat([header, entry.name])
}

function createStoredZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const localParts: Uint8Array[] = []
  const entries: ZipEntry[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.content)
    const entry = { name, data, crc: crc32(data), offset }
    const local = localHeader(entry)
    entries.push(entry)
    localParts.push(local)
    offset += local.length
  }

  const centralParts = entries.map(centralHeader)
  const central = concat(centralParts)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, central.length, true)
  endView.setUint32(16, offset, true)
  return concat([...localParts, central, end])
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
}

export function serializeDocx(document: ExportDocument): Uint8Array {
  const paragraphs = [document.title, ""]
  for (const block of document.blocks) {
    paragraphs.push(block.title, ...block.paragraphs)
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(paragraph).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`

  return createStoredZip([
    {
      name: "[Content_Types].xml",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    { name: "word/document.xml", content: documentXml },
  ])
}

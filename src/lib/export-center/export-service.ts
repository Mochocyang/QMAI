import { invoke } from "@tauri-apps/api/core"
import { serializeDocx } from "./docx-exporter"
import { sanitizeExportFileName, serializeTxt } from "./txt-exporter"
import type { ExportDocument, ExportFormat } from "./types"

interface SaveOptions {
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
}

export interface ExportServiceDeps {
  saveFile(options: SaveOptions): Promise<string | null>
  writeBinary(path: string, bytes: Uint8Array): Promise<void>
}

export interface ExportRunResult {
  status: "success" | "cancelled"
  exportedCount: number
}

export const MAX_EXPORT_BYTES = 64 * 1024 * 1024

export function assertExportByteLength(byteLength: number): void {
  if (byteLength > MAX_EXPORT_BYTES) {
    throw new Error("导出文件超过 64 MiB 限制，请缩小导出范围。")
  }
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export function encodeExportBytesBase64(bytes: Uint8Array): string {
  assertExportByteLength(bytes.byteLength)
  let output = ""
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const hasSecond = index + 1 < bytes.length
    const hasThird = index + 2 < bytes.length
    const second = hasSecond ? bytes[index + 1] : 0
    const third = hasThird ? bytes[index + 2] : 0
    const combined = (first << 16) | (second << 8) | third
    output += BASE64_ALPHABET[(combined >>> 18) & 0x3f]
    output += BASE64_ALPHABET[(combined >>> 12) & 0x3f]
    output += hasSecond ? BASE64_ALPHABET[(combined >>> 6) & 0x3f] : "="
    output += hasThird ? BASE64_ALPHABET[combined & 0x3f] : "="
  }
  return output
}

const defaultDeps: ExportServiceDeps = {
  saveFile: async (options) => {
    const { save } = await import("@tauri-apps/plugin-dialog")
    return save(options)
  },
  writeBinary: async (path, bytes) => {
    await invoke("write_export_file", { path, contentsBase64: encodeExportBytesBase64(bytes) })
  },
}

export async function exportDocuments(
  documents: ExportDocument[],
  format: ExportFormat,
  deps: ExportServiceDeps = defaultDeps,
  shouldContinue: () => boolean = () => true,
): Promise<ExportRunResult> {
  let exportedCount = 0
  const filter = format === "txt"
    ? { name: "UTF-8 文本", extensions: ["txt"] }
    : { name: "Word 文档", extensions: ["docx"] }

  for (const document of documents) {
    if (!shouldContinue()) return { status: "cancelled", exportedCount }
    const defaultPath = `${sanitizeExportFileName(document.title)}.${format}`
    const path = await deps.saveFile({ defaultPath, filters: [filter] })
    if (!path) return { status: "cancelled", exportedCount }

    const bytes = format === "txt" ? serializeTxt(document) : serializeDocx(document)
    assertExportByteLength(bytes.byteLength)
    try {
      await deps.writeBinary(path, bytes)
    } catch {
      throw new Error("导出文件写入失败，请检查保存位置和磁盘空间。")
    }
    exportedCount += 1
  }

  return { status: "success", exportedCount }
}

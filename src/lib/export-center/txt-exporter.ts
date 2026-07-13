import type { ExportDocument } from "./types"

const WINDOWS_INVALID_FILE_NAME = /[<>:"/\\|?*\u0000-\u001f]/g
const WINDOWS_DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
export const MAX_EXPORT_FILE_NAME_LENGTH = 120

export function sanitizeExportFileName(value: string): string {
  const cleaned = value
    .replace(WINDOWS_INVALID_FILE_NAME, "")
    .trim()
    .replace(/[. ]+$/g, "")
  const truncated = Array.from(cleaned)
    .slice(0, MAX_EXPORT_FILE_NAME_LENGTH)
    .join("")
    .replace(/[. ]+$/g, "")
  const safe = truncated || "未命名作品"
  const stem = safe.split(".", 1)[0]
  return WINDOWS_DEVICE_NAME.test(stem) ? `_${safe}` : safe
}

export function serializeTxt(document: ExportDocument): Uint8Array {
  const parts = [document.title]
  for (const block of document.blocks) {
    parts.push(block.title, ...block.paragraphs)
  }
  return new TextEncoder().encode(`${parts.join("\n\n")}\n`)
}

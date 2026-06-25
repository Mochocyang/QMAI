import { normalizePath } from "@/lib/path-utils"
import { isTauri } from "@/lib/platform"
import { convertFileSrc } from "@tauri-apps/api/core"

const PASSTHROUGH_RE = /^(https?:|data:|blob:|file:|tauri:)/i

export function resolveMarkdownImageSrc(
  rawSrc: string,
  projectPath: string | null,
): string {
  if (!rawSrc) return rawSrc
  if (PASSTHROUGH_RE.test(rawSrc)) return rawSrc

  if (!projectPath) return rawSrc

  if (!isTauri()) return rawSrc

  const pp = normalizePath(projectPath)
  const isAbsolute =
    rawSrc.startsWith("/") || /^[a-zA-Z]:/.test(rawSrc) || rawSrc.startsWith("\\\\")

  if (isAbsolute) return convertFileSrc(rawSrc)

  const cleaned = rawSrc.replace(/^\.\//, "")
  const absolute = `${pp}/wiki/${cleaned}`

  return convertFileSrc(absolute)
}

export async function resolveMarkdownImageSrcAsync(
  rawSrc: string,
  projectPath: string | null,
): Promise<string> {
  if (!rawSrc) return rawSrc
  if (PASSTHROUGH_RE.test(rawSrc)) return rawSrc
  if (!projectPath) return rawSrc
  if (!isTauri()) return rawSrc

  const pp = normalizePath(projectPath)
  const isAbsolute =
    rawSrc.startsWith("/") || /^[a-zA-Z]:/.test(rawSrc) || rawSrc.startsWith("\\\\")

  if (isAbsolute) return convertFileSrc(rawSrc)

  const cleaned = rawSrc.replace(/^\.\//, "")
  const absolute = `${pp}/wiki/${cleaned}`
  return convertFileSrc(absolute)
}

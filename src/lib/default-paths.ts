const FALLBACK_INSTALL_DRIVE = "D"

export const DEFAULT_NOVEL_DIR_NAME = "QM-BOOK"
export const DEFAULT_INSTALL_DIR_NAME = "QMaiWrite"

function extractWindowsDriveLetter(pathLike: string): string | null {
  const match = pathLike.trim().match(/^([a-zA-Z]):[\\/]/)
  return match ? match[1].toUpperCase() : null
}

export function buildDefaultNovelDir(pathLike: string): string {
  const drive = extractWindowsDriveLetter(pathLike) ?? FALLBACK_INSTALL_DRIVE
  return `${drive}:\\${DEFAULT_NOVEL_DIR_NAME}`
}

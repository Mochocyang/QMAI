const FALLBACK_INSTALL_DRIVE = "D"

// 新版为唯一正式版，直接使用正式小说目录 QM-BOOK。
const DEFAULT_NOVEL_DIR_NAME = "QM-BOOK"

function extractWindowsDriveLetter(pathLike: string): string | null {
  const match = pathLike.trim().match(/^([a-zA-Z]):[\\/]/)
  return match ? match[1].toUpperCase() : null
}

export function buildDefaultNovelDir(pathLike: string): string {
  const drive = extractWindowsDriveLetter(pathLike) ?? FALLBACK_INSTALL_DRIVE
  return `${drive}:\\${DEFAULT_NOVEL_DIR_NAME}`
}

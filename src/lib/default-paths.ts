import { IS_UI_TEST_BUILD } from "@/lib/ui-test"

const FALLBACK_INSTALL_DRIVE = "D"

// 正式版继续使用 QM-BOOK；UI 测试版使用独立目录，避免与正式小说混写。
const DEFAULT_NOVEL_DIR_NAME = IS_UI_TEST_BUILD ? "QM-BOOK-UI-TEST" : "QM-BOOK"

function extractWindowsDriveLetter(pathLike: string): string | null {
  const match = pathLike.trim().match(/^([a-zA-Z]):[\\/]/)
  return match ? match[1].toUpperCase() : null
}

export function buildDefaultNovelDir(pathLike: string): string {
  const drive = extractWindowsDriveLetter(pathLike) ?? FALLBACK_INSTALL_DRIVE
  return `${drive}:\\${DEFAULT_NOVEL_DIR_NAME}`
}

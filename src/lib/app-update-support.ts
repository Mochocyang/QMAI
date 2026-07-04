import { isTauri } from "@/lib/platform"

export const APP_AUTO_UPDATE_RELEASES_URL = "https://github.com/Mochocyang/QMAI/releases"

export const APP_AUTO_UPDATE_UNSUPPORTED_MESSAGE =
  "当前平台暂不支持应用内自动更新，请前往 GitHub Releases 手动下载安装包。"

export function getDesktopPlatform(): "windows" | "macos" | "linux" | "unknown" {
  if (!isTauri()) return "unknown"

  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return "windows"
  if (/Mac/i.test(ua)) return "macos"
  if (/Linux/i.test(ua)) return "linux"
  return "unknown"
}

export function isAppAutoUpdateSupported(): boolean {
  return getDesktopPlatform() === "windows"
}

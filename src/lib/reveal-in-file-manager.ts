/**
 * 在系统文件管理器中显示文件
 * - Tauri: 用 opener 插件的 revealItemInDir
 * - 浏览器: 退化为在浏览器里打开文件链接（多数情况不可用，但不会硬崩）
 */

import { isTauri } from "@/lib/platform"

export async function revealInFileManager(filePath: string): Promise<void> {
  if (!filePath) return
  if (isTauri()) {
    try {
      const opener = await import("@tauri-apps/plugin-opener")
      const reveal = (opener as { revealItemInDir?: (path: string) => Promise<void> })
        .revealItemInDir
      if (typeof reveal === "function") {
        await reveal(filePath)
        return
      }
      const openPath = (opener as { openPath?: (path: string) => Promise<void> }).openPath
      if (typeof openPath === "function") {
        await openPath(filePath)
        return
      }
    } catch (error) {
      console.warn("[revealInFileManager] Tauri opener 失败", error)
    }
  }
  // 兜底：浏览器里打开（多数 OS 不会真的显示）
  try {
    window.open(`file://${filePath.replace(/\\/g, "/")}`, "_blank", "noopener,noreferrer")
  } catch (error) {
    console.warn("[revealInFileManager] 浏览器兜底失败", error)
  }
}

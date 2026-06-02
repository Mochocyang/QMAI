import { isTauri } from "@/lib/platform"

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener")
      await openUrl(url)
      return
    } catch (error) {
      console.warn("[openExternalUrl] Tauri opener failed, falling back to window.open:", error)
    }
  }

  window.open(url, "_blank", "noopener,noreferrer")
}

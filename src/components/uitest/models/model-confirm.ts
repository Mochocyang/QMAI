import { isTauri } from "@/lib/platform"
import { toast } from "@/lib/toast"

let confirming = false
/** 桌面注入的window.confirm并非同步布尔值，使用受支持的message封装并等待用户选择。 */
export async function confirmModelAction(message: string): Promise<boolean> {
  if (confirming) return false
  confirming = true
  try {
    if (isTauri()) {
      const { confirm } = await import("@tauri-apps/plugin-dialog")
      return await confirm(message, { title: "模型配置确认", kind: "warning", okLabel: "继续", cancelLabel: "取消" })
    }
    return (await window.confirm(message)) === true
  } catch {
    toast.error("无法打开模型操作确认框，本次操作已取消。请重试，尚未保存的输入仍保留。")
    return false
  } finally { confirming = false }
}

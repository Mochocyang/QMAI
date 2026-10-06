import { isTauri } from "@/lib/platform"
import { toast } from "@/lib/toast"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"

let confirming = false
export type ModelDraftChoice = "leave" | "save" | "cancel"

/** 原生布尔确认无法区分关闭窗口与“离开”，草稿操作使用同一个应用内弹窗。 */
export async function confirmModelDraftAction(): Promise<ModelDraftChoice> {
  if (confirming) return "cancel"
  confirming = true
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    return await new Promise<ModelDraftChoice>(resolve => {
      root.render(createElement(Dialog, { open: true, onOpenChange: open => { if (!open) resolve("cancel") } },
        createElement(DialogContent, {},
          createElement(DialogTitle, {}, "未保存的模型配置"),
          createElement(DialogDescription, {}, "模型配置还有未保存的修改。离开会放弃这些修改，已保存的开关和配置不受影响。"),
          createElement(DialogFooter, {},
            createElement("button", { type: "button", className: "model-button ghost", onClick: () => resolve("leave") }, "离开"),
            createElement("button", { type: "button", className: "model-button primary", onClick: () => resolve("save") }, "保存配置")))))
    })
  } catch {
    toast.error("无法打开模型操作确认框，本次操作已取消。尚未保存的输入仍保留。")
    return "cancel"
  } finally { root.unmount(); host.remove(); confirming = false }
}
/** 桌面注入的window.confirm并非同步布尔值，使用受支持的message封装并等待用户选择。 */
export async function confirmModelAction(message: string, title = "模型配置确认"): Promise<boolean> {
  if (confirming) return false
  confirming = true
  try {
    if (isTauri()) {
      const { confirm } = await import("@tauri-apps/plugin-dialog")
      return await confirm(message, { title, kind: "warning", okLabel: "继续", cancelLabel: "取消" })
    }
    return (await window.confirm(message)) === true
  } catch {
    toast.error("无法打开模型操作确认框，本次操作已取消。请重试，尚未保存的输入仍保留。")
    return false
  } finally { confirming = false }
}

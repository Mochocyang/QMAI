import { isTauri } from "@/lib/platform"
import type { Update } from "@tauri-apps/plugin-updater"

type UpdaterBindings = {
  isTauri: boolean
  check: () => Promise<Update | null>
  confirm: (message: string, options?: Record<string, unknown>) => Promise<boolean>
  message: (message: string, options?: Record<string, unknown>) => Promise<unknown>
}

let updateCheckStarted = false

export async function runAppUpdateFlow(bindings: UpdaterBindings) {
  if (!bindings.isTauri) return

  const update = await bindings.check()
  if (!update) return

  const notes = update.body?.trim() ? `\n\n更新说明：\n${update.body.trim()}` : ""
  const confirmed = await bindings.confirm(
    `检测到新版本 ${update.version}。是否立即下载并安装？${notes}`,
    {
      title: "发现新版本",
      kind: "info",
      okLabel: "立即更新",
      cancelLabel: "稍后再说",
    },
  )
  if (!confirmed) return

  // 先下载更新包
  try {
    await bindings.message(
      "正在下载更新，请稍候...",
      {
        title: "下载更新",
        kind: "info",
        okLabel: "知道了",
      },
    )
    await update.download()
  } catch (error) {
    await bindings.message(
      `下载更新失败：${error instanceof Error ? error.message : String(error)}\n\n请稍后重试或前往 GitHub 手动下载安装包。`,
      {
        title: "下载失败",
        kind: "error",
        okLabel: "知道了",
      },
    )
    return
  }

  // 下载完成后，提示用户即将退出并安装
  const installConfirmed = await bindings.confirm(
    "更新已下载完成。点击「立即安装」将关闭软件并开始安装，请确保已保存编辑内容。",
    {
      title: "准备安装",
      kind: "info",
      okLabel: "立即安装",
      cancelLabel: "稍后安装",
    },
  )
  if (!installConfirmed) return

  // 调用安装，软件会在安装前自动退出
  try {
    await update.install()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    // 正常退出关键词：软件在安装过程中重启属于预期行为
    const normalExitKeywords = ["process exited", "disconnected", "closed"]
    const isNormalExit = normalExitKeywords.some((kw) => msg.toLowerCase().includes(kw.toLowerCase()))
    if (isNormalExit) return
    console.error("安装更新失败：", error)
    try {
      await bindings.message(
        `安装更新失败：${msg}\n\n请稍后重试或前往 GitHub 手动下载安装包。`,
        {
          title: "安装失败",
          kind: "error",
          okLabel: "知道了",
        },
      )
    } catch {
      console.error("显示安装失败对话框也失败了：", error)
    }
  }
}

export async function checkForAppUpdate() {
  if (!isTauri() || updateCheckStarted) return

  updateCheckStarted = true
  try {
    const [{ check }, { confirm, message }] = await Promise.all([
      import("@tauri-apps/plugin-updater"),
      import("@tauri-apps/plugin-dialog"),
    ])
    await runAppUpdateFlow({
      isTauri: true,
      check,
      confirm,
      message,
    })
  } catch (error) {
    console.warn("检查应用更新失败：", error)
  } finally {
    updateCheckStarted = false
  }
}

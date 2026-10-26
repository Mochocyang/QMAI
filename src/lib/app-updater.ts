import { isAppAutoUpdateSupported } from "@/lib/app-update-support"
import { isTauri } from "@/lib/platform"
import type { Update } from "@tauri-apps/plugin-updater"

type UpdaterBindings = {
  isTauri: boolean
  /**
   * `options` 会透传给 plugin-updater 的 `check()`。
   *
   * 为什么必须留这个口子：插件自己的 http 客户端**不读**我们写进环境变量的
   * `HTTP_PROXY`，用户开了代理对「检查更新」完全无效（实测发现）。插件从 2.11
   * 起支持 `check({ proxy, timeout })`，把代理显式传进去才真正生效。
   * 探活得到的加速通道地址、超时上限也走这里。
   */
  check: (options?: { proxy?: string; timeout?: number }) => Promise<Update | null>
  confirm: (message: string, options?: Record<string, unknown>) => Promise<boolean>
  message: (message: string, options?: Record<string, unknown>) => Promise<unknown>
  /** 当前生效的代理地址（用户自己配的），没有就 undefined。 */
  resolveProxy?: () => Promise<string | undefined>
  /** 后台静默检查：没新版本时不打扰用户。用户主动点「检查更新」时为 false。 */
  silent?: boolean
}

let updateCheckStarted = false

/**
 * 跑完一次完整的应用更新流程：检查 → 确认 → 下载 → 确认 → 安装。
 *
 * 导出是必需的：app-updater.test.ts 直接测这个函数。01aab5f 曾把它当成
 * "未使用的导出"删掉 export（只看了 src 里的非测试引用），导致那 4 个用例
 * 以 `runAppUpdateFlow is not a function` 全红，而真正的更新功能已经因此
 * 死掉却无人察觉。
 */
export async function runAppUpdateFlow(bindings: UpdaterBindings) {
  if (!bindings.isTauri) return

  /*
   * 10 秒上限：用户抱怨过"点检查更新毫无反应 20 秒"。
   * 这个值要大于单条通道的探活时间（5s），又要小到用户能忍。
   */
  const CHECK_TIMEOUT_MS = 10_000
  const proxy = bindings.resolveProxy ? await bindings.resolveProxy() : undefined

  /*
   * 先问 Rust 的 updater_check：它按「内置 + 远程覆盖」的通道表逐个试镜像，
   * 失败才轮到直连。
   *
   * 为什么必须先用它：插件命令层的 `check()` **吃的是编译期 endpoints**，
   * 而我们真正想要的是"镜像表能远程更新、不用发版"。
   * 之前这条流程直接调 `bindings.check()`，所以永远只试 github.com 直连 ——
   * 用户在国内点了必然失败（这就是"镜像没效果"的真正原因）。
   */
  let hasUpdate: { version: string; notes?: string; downloadUrl?: string } | null = null
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const info = await invoke<{
      version: string | null
      notes: string | null
      downloadUrl: string | null
    }>("updater_check")
    hasUpdate = info?.version
      ? { version: info.version, notes: info.notes ?? undefined, downloadUrl: info.downloadUrl ?? undefined }
      : null
  } catch (error) {
    console.warn("[updater] 通道检查失败，退回插件端点：", error)
    hasUpdate = undefined as never
  }

  if (hasUpdate === null) {
    if (bindings.silent === false) {
      await bindings.message("已经是最新版本了。", {
        title: "检查更新",
        kind: "info",
        okLabel: "知道了",
      })
    }
    return
  }

  const update = await bindings.check({ proxy, timeout: CHECK_TIMEOUT_MS })
  if (!update) {
    // 用户主动点的就要有回应："已经是最新版本"也是结果，沉默等于"点了没用"。
    if (bindings.silent === false) {
      await bindings.message("已经是最新版本了。", {
        title: "检查更新",
        kind: "info",
        okLabel: "知道了",
      })
    }
    return
  }

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
      `下载更新失败：${error instanceof Error ? error.message : String(error)}

网络连不上 GitHub 时可以：稍后重试；或在设置里配置自己的代理后重试；也可以前往 GitHub 手动下载安装包。`,
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

/**
 * 读出用户配好的代理地址（没启用或地址非法时返回 undefined）。
 *
 * 为什么更新要单独读一次：`tauri-plugin-updater` 有自己的 http 客户端，
 * **不读**我们写进环境变量的 HTTP_PROXY。不显式传进去，用户开了代理
 * 对「检查更新」也毫无作用（实测发现，不是猜测）。
 */
async function resolveProxyForUpdate(): Promise<string | undefined> {
  try {
    const { useWikiStore } = await import("@/stores/wiki-store")
    const proxy = useWikiStore.getState().proxyConfig
    if (!proxy?.enabled) return undefined
    const url = proxy.url?.trim() ?? ""
    if (!url.startsWith("http://") && !url.startsWith("https://")) return undefined
    return url
  } catch {
    return undefined
  }
}

/**
 * 检查一次更新。
 *
 * `silent`（默认 true）是后台自动检查：没新版本就不打扰。
 * 用户主动点「检查更新」时传 `silent: false` —— 他主动点了就要有回应，
 * 即使"已经是最新版本"也要说一声，否则只会觉得点了没用。
 */
export async function checkForAppUpdate(options: { silent?: boolean } = {}) {
  const silent = options.silent ?? true
  if (!isTauri() || !isAppAutoUpdateSupported() || updateCheckStarted) return

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
      resolveProxy: resolveProxyForUpdate,
      silent,
    })
  } catch (error) {
    console.warn("检查应用更新失败：", error)
    if (!silent) {
      try {
        const { message } = await import("@tauri-apps/plugin-dialog")
        await message(
          `检查更新失败：${error instanceof Error ? error.message : String(error)}\n\n网络连不上 GitHub 时可以：稍后重试；或先在「设置 → 网络」里配置代理再试；也可以前往 GitHub 手动下载安装包。`,
          { title: "检查更新失败", kind: "error", okLabel: "知道了" },
        )
      } catch {
        // 连弹窗都起不来就算了，别让更新流程抛未捕获异常。
      }
    }
  } finally {
    updateCheckStarted = false
  }
}

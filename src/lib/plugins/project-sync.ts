/**
 * 把「当前项目」同步给插件宿主（`plugins_set_project`）。
 *
 * ## 为什么它不是"插件中心的一部分"，而要单独一个模块
 *
 * `/host/project/*` 这条通道生效的前提是 Rust 侧知道"现在打开的是哪个项目"。
 * 这件事的调用点在**项目生命周期**里（打开 / 切换 / 关闭），而不是插件界面里 ——
 * 写在插件中心的话，用户不打开插件中心就用不了任何项目相关的 action。
 *
 * ## 为什么失败只 `console.warn`
 *
 * 插件系统是**附加功能**。如果 `plugins_set_project` 失败（命令没注册、路径被判非法、
 * 插件系统内部坏了）就阻断项目打开，等于让一个可卸载的第三方子系统决定用户
 * 能不能打开自己的书 —— 那是本末倒置。这里只记 warn，项目照常打开。
 *
 * 反过来，**关闭**时也要显式传 `null`：不传的话 Rust 侧会继续持有上一个项目的
 * 根目录，下一次 action 就会往一本已经关掉的、甚至可能被移走的书里写东西。
 */
import { invoke } from "@tauri-apps/api/core"

/** 命令名单独导出，供测试与排查复用（写错一次就会静默不生效）。 */
export const PLUGINS_SET_PROJECT_COMMAND = "plugins_set_project"

/**
 * 通知插件宿主当前项目。
 *
 * @param root 项目根目录；`null`（或空串）表示"关闭项目"。
 * @returns 永远 resolve —— 调用方不需要 try/catch，也不该因此改变项目打开的结果。
 */
export async function syncPluginsProject(root: string | null): Promise<void> {
  const value = typeof root === "string" && root.trim() !== "" ? root : null
  try {
    await invoke(PLUGINS_SET_PROJECT_COMMAND, { root: value })
  } catch (cause) {
    console.warn("[plugins] 同步当前项目到插件宿主失败（不影响项目读写，插件项目相关能力暂不可用）：", cause)
  }
}

/** 项目对象里我们只需要根目录（见 `syncPluginsProject`）。 */
export interface ProjectLike {
  path: string
}

/**
 * 打开/切换项目：**先真的打开，成功了再通知插件宿主**。
 *
 * 顺序是硬约束：打开失败时绝不能通知插件 —— 否则插件会拿着一个"其实没打开成功"
 * 的路径去读文件，用户看到的是"插件报错 + 项目没开"两件互不相关的事。
 * 打开失败会原样抛给调用方（项目打开失败的提示由调用方负责，格式各不相同）。
 */
export async function openProjectWithPluginSync<T extends ProjectLike>(
  open: () => Promise<T>,
): Promise<T> {
  const project = await open()
  await syncPluginsProject(project.path)
  return project
}

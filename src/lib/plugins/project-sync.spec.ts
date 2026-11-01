/**
 * `plugins_set_project` 调用点的测试。
 *
 * 这四条断言对应四种真实事故：
 *   1. 打开项目后没通知 → `/host/project/*` 全线 403/空，用户以为插件坏了；
 *   2. 关闭项目后还留着旧根目录 → 下一次 action 往已经关掉的书写东西；
 *   3. 打开失败也通知 → 插件拿着一个不存在的路径去读文件；
 *   4. 通知失败导致抛错 → 插件系统坏了却打不开自己的书。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

import {
  PLUGINS_SET_PROJECT_COMMAND,
  openProjectWithPluginSync,
  syncPluginsProject,
} from "./project-sync"

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue(undefined)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("syncPluginsProject", () => {
  it("打开/切换项目 → 调一次，参数是新项目路径", async () => {
    await syncPluginsProject("D:/QM-BOOK/长夜")

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(PLUGINS_SET_PROJECT_COMMAND, { root: "D:/QM-BOOK/长夜" })
  })

  it("关闭项目 → 传 null", async () => {
    await syncPluginsProject(null)
    expect(invoke).toHaveBeenCalledWith(PLUGINS_SET_PROJECT_COMMAND, { root: null })
  })

  it("空串按关闭处理（不会把空路径当成项目根）", async () => {
    await syncPluginsProject("   ")
    expect(invoke).toHaveBeenCalledWith(PLUGINS_SET_PROJECT_COMMAND, { root: null })
  })

  it("命令失败只 warn，永远不抛（插件坏了不能让人打不开项目）", async () => {
    invoke.mockRejectedValue("插件系统尚未就绪")

    await expect(syncPluginsProject("D:/QM-BOOK/长夜")).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })
})

describe("openProjectWithPluginSync", () => {
  it("打开成功后才通知，且正好一次", async () => {
    const order: string[] = []
    invoke.mockImplementation(async () => {
      order.push("plugins_set_project")
    })
    const open = vi.fn(async () => {
      order.push("open_project")
      return { id: "p1", name: "长夜", path: "D:/QM-BOOK/长夜" }
    })

    const project = await openProjectWithPluginSync(open)

    expect(project.path).toBe("D:/QM-BOOK/长夜")
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(PLUGINS_SET_PROJECT_COMMAND, { root: "D:/QM-BOOK/长夜" })
    // 顺序：先打开，再通知
    expect(order).toEqual(["open_project", "plugins_set_project"])
  })

  it("打开失败 → 一次都不调用，错误原样抛给调用方", async () => {
    const open = vi.fn(async () => {
      throw new Error("目录不存在：D:/QM-BOOK/长夜")
    })

    await expect(openProjectWithPluginSync(open)).rejects.toThrow("目录不存在")
    expect(invoke).not.toHaveBeenCalled()
  })
})

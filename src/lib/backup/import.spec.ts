// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  invokeMock,
  listenMock,
  unlistenMock,
  loadRegistryMock,
  upsertProjectInfoMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  unlistenMock: vi.fn(),
  loadRegistryMock: vi.fn(),
  upsertProjectInfoMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }))
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }))
vi.mock("@/lib/project-identity", () => ({
  loadRegistry: loadRegistryMock,
  upsertProjectInfo: upsertProjectInfoMock,
}))
vi.mock("@/lib/project-refresh", () => ({ refreshProjectState: vi.fn() }))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: { getState: () => ({ project: null }) },
}))

import { importBackup } from "./import"

const preview = {
  backupVersion: 2,
  contents: { globalConfig: true, uiPreferences: true, credentials: false },
  projects: [],
}

function importResult(replaceLocalStorage: boolean) {
  return {
    success: true,
    appState: null,
    localStorageData: { "qmai-new-layout": "wide" },
    replaceLocalStorage,
    projects: [],
    warnings: [],
    error: null,
  }
}

describe("V2 备份导入适配", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    listenMock.mockResolvedValue(unlistenMock)
    // loadRegistry 必须返回对象：导入成功路径会对它取下标
    loadRegistryMock.mockResolvedValue({})
    upsertProjectInfoMock.mockResolvedValue(undefined)
  })

  it("部分界面偏好采用合并恢复并保留当前键", async () => {
    localStorage.setItem("qmai-existing-layout", "compact")
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_backup_manifest") return Promise.resolve(preview)
      if (command === "import_backup") return Promise.resolve(importResult(false))
      throw new Error(`unexpected command: ${command}`)
    })

    await importBackup("full", undefined, undefined, "C:/backup/partial.zip")

    expect(localStorage.getItem("qmai-existing-layout")).toBe("compact")
    expect(localStorage.getItem("qmai-new-layout")).toBe("wide")
  })

  it("完整或 V1 界面偏好仍清除旧键后恢复", async () => {
    localStorage.setItem("qmai-existing-layout", "compact")
    localStorage.setItem("unrelated", "keep")
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_backup_manifest") return Promise.resolve(preview)
      if (command === "import_backup") return Promise.resolve(importResult(true))
      throw new Error(`unexpected command: ${command}`)
    })

    await importBackup("full", undefined, undefined, "C:/backup/full.zip")

    expect(localStorage.getItem("qmai-existing-layout")).toBeNull()
    expect(localStorage.getItem("qmai-new-layout")).toBe("wide")
    expect(localStorage.getItem("unrelated")).toBe("keep")
  })

  it("仅导入全局配置时不检查项目路径", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_backup_manifest") throw new Error("不应读取项目路径")
      if (command === "import_backup") return Promise.resolve(importResult(false))
      throw new Error(`unexpected command: ${command}`)
    })

    const result = await importBackup("global-only", undefined, undefined, "C:/backup/global.zip")

    expect(result.success).toBe(true)
    expect(invokeMock).not.toHaveBeenCalledWith("read_backup_manifest", expect.anything())
  })

  it("备份带了 qm-uitest- 时整组替换（皮肤跟着备份走）", async () => {
    localStorage.setItem("qm-uitest-skin", "jing")
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_backup_manifest") return Promise.resolve(preview)
      if (command === "import_backup") {
        return Promise.resolve({
          ...importResult(true),
          localStorageData: { "qmai-new-layout": "wide", "qm-uitest-skin": "xing" },
        })
      }
      throw new Error(`unexpected command: ${command}`)
    })

    await importBackup("full", undefined, undefined, "C:/backup/with-skin.zip")

    expect(localStorage.getItem("qm-uitest-skin")).toBe("xing")
  })

  it("旧备份不含 qm-uitest- 时不得删除本机书架索引", async () => {
    // 这是防数据丢失的关键用例：旧版本导出的备份没有 qm-uitest- 组，
    // 若按前缀表一律清空，书架索引会被删掉且备份里没有东西能填回来 ——
    // 用户看到的是"恢复完一本书都没有了"。
    const library = JSON.stringify({
      schemaVersion: 1,
      projects: [{ id: "p1", name: "长安夜雨", path: "C:/Novel" }],
    })
    localStorage.setItem("qm-uitest-library", library)
    localStorage.setItem("qm-uitest-skin", "jing")
    localStorage.setItem("qmai-existing-layout", "compact")
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_backup_manifest") return Promise.resolve(preview)
      // 只带 qmai 组，模拟老版本备份
      if (command === "import_backup") return Promise.resolve(importResult(true))
      throw new Error(`unexpected command: ${command}`)
    })

    await importBackup("full", undefined, undefined, "C:/backup/legacy.zip")

    expect(localStorage.getItem("qm-uitest-library")).toBe(library)
    expect(localStorage.getItem("qm-uitest-skin")).toBe("jing")
    // 备份真的带了的组仍然照常整体替换
    expect(localStorage.getItem("qmai-existing-layout")).toBeNull()
  })

  it("恢复成功的项目会登记进书架索引", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "read_backup_manifest") return Promise.resolve(preview)
      if (command === "import_backup") {
        return Promise.resolve({
          ...importResult(false),
          localStorageData: null,
          // 模拟「仅项目内容」备份：不含 app-state 也不含 localStorage，
          // 项目只存在于磁盘与 project-registry.json 里。
          projects: [
            { id: "p1", path: "C:/Novel", name: "长安夜雨", success: true, error: null },
            { id: "p2", path: "C:/Broken", name: "失败的书", success: false, error: "磁盘错误" },
          ],
        })
      }
      throw new Error(`unexpected command: ${command}`)
    })

    await importBackup("full", undefined, undefined, "C:/backup/projects-only.zip")

    const index = JSON.parse(localStorage.getItem("qm-uitest-library") ?? "null")
    expect(index?.projects).toEqual([{ id: "p1", name: "长安夜雨", path: "C:/Novel" }])
    // 恢复失败的项目不能进书架，否则书架上会出现打不开的书
    expect(index?.projects.some((p: { id: string }) => p.id === "p2")).toBe(false)
  })

  /*
   * 批量登记被拒时要退化成逐本登记。
   *
   * 书架索引会校验每条记录（书名/路径合法性），一条不合格会让整批写入失败。
   * 若批量失败就放弃，其余完全正常的书也一起上不了书架 ——
   * 用户看到的是"恢复成功了，但书架上没有书"。
   */
  it("批量登记失败时逐本重试，正常的书仍然进书架", async () => {
    /*
     * 书架索引会校验每条记录，一条不合格就会让**整批**写入被拒绝。
     * 这里用一个会写穿到真实 localStorage 的 setItem 替身：
     * 批量那一次（数组里含"坏书"）抛错，逐本重试时"好书"必须能写进去。
     * 若实现里批量失败就放弃，这条会失败 —— 用户看到的就是
     * "恢复成功了，但书架上没有书"。
     */
    const realSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (value.includes("坏书")) throw new Error("书架索引写入失败")
      return realSetItem.call(this, key, value)
    }) as unknown as { mock: { calls: unknown[][] } }

    try {
      invokeMock.mockImplementation((command: string) => {
        if (command === "read_backup_manifest") return Promise.resolve(preview)
        if (command === "import_backup") {
          return Promise.resolve({
            ...importResult(false),
            localStorageData: null,
            projects: [
              { id: "p1", path: "C:/Ok", name: "好书", success: true, error: null },
              { id: "p2", path: "C:/Bad", name: "坏书", success: true, error: null },
            ],
          })
        }
        throw new Error(`unexpected command: ${command}`)
      })

      await importBackup("full", undefined, undefined, "C:/backup/mixed.zip")
    } finally {
      setItem.mockRestore()
    }

    const index = JSON.parse(localStorage.getItem("qm-uitest-library") ?? "null")
    expect(index?.projects?.map((p: { name: string }) => p.name)).toEqual(["好书"])
  })
})

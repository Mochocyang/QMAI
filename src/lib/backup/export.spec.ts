// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock, saveMock, listenMock, unlistenMock, registryMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  saveMock: vi.fn(),
  listenMock: vi.fn(),
  unlistenMock: vi.fn(),
  registryMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: saveMock }))
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }))
vi.mock("@/lib/project-identity", () => ({ loadRegistry: registryMock }))

import { exportBackup } from "./export"

describe("数据管理备份导出参数", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveMock.mockResolvedValue("C:/backup/qmai.zip")
    listenMock.mockResolvedValue(unlistenMock)
    invokeMock.mockResolvedValue({
      success: true,
      warnings: [],
      fileCount: 1,
      totalSize: 128,
      error: null,
    })
    registryMock.mockResolvedValue({
      p1: { id: "p1", name: "长安夜雨", path: "C:/Novel", lastOpened: 2 },
      p2: { id: "p2", name: "旧梦", path: "C:/Old", lastOpened: 1 },
    })
    localStorage.clear()
    localStorage.setItem("qmai-ui-density", "compact")
    localStorage.setItem("qmai_fallback_fingerprint", "sensitive-fingerprint")
    localStorage.setItem("unrelated", "keep-local-only")
  })

  it("只传递用户选中的项目、数据类别和全局选项", async () => {
    await exportBackup({
      includeGlobalConfig: true,
      includeUiPreferences: true,
      includeCredentials: false,
      projects: [{
        id: "p1",
        name: "长安夜雨",
        path: "C:/Novel",
        sections: ["content", "indexes"],
      }],
    })

    expect(invokeMock).toHaveBeenCalledWith("export_backup", {
      params: {
        savePath: "C:/backup/qmai.zip",
        includeGlobalConfig: true,
        includeUiPreferences: true,
        includeCredentials: false,
        localStorageData: { "qmai-ui-density": "compact" },
        projects: [{
          id: "p1",
          name: "长安夜雨",
          path: "C:/Novel",
          sections: ["content", "indexes"],
        }],
      },
    })
  })

  it("未选择界面偏好时不收集 localStorage", async () => {
    await exportBackup({
      includeGlobalConfig: true,
      includeUiPreferences: false,
      includeCredentials: true,
      projects: [],
    })

    expect(invokeMock).toHaveBeenCalledWith("export_backup", {
      params: expect.objectContaining({ localStorageData: {} }),
    })
  })

  it("皮肤与书架索引（qm-uitest-）会进入备份", async () => {
    localStorage.setItem("qm-uitest-skin", "zhi")
    localStorage.setItem("qm-uitest-library", '{"schemaVersion":1,"projects":[]}')

    await exportBackup({
      includeGlobalConfig: false,
      includeUiPreferences: true,
      includeCredentials: false,
      projects: [],
    })

    const params = invokeMock.mock.calls[0][1].params
    // 这两个键此前不在前缀表里 → 换机恢复后皮肤回到默认、书架为空，
    // 而导出的结果却报告"成功"，用户无从判断丢了什么。
    expect(params.localStorageData["qm-uitest-skin"]).toBe("zhi")
    expect(params.localStorageData["qm-uitest-library"]).toBe('{"schemaVersion":1,"projects":[]}')
  })
})

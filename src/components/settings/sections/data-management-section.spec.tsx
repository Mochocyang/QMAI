// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { exportMock, registryMock, readManifestMock, selectBackupMock } = vi.hoisted(() => ({
  exportMock: vi.fn(),
  registryMock: vi.fn(),
  readManifestMock: vi.fn(),
  selectBackupMock: vi.fn(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}))
vi.mock("@/lib/backup/export", () => ({ exportBackup: exportMock }))
vi.mock("@/lib/project-identity", () => ({ loadRegistry: registryMock, upsertProjectInfo: vi.fn() }))
vi.mock("@/lib/backup/import", () => ({
  importBackup: vi.fn(),
  readBackupManifest: readManifestMock,
  selectBackupFile: selectBackupMock,
}))

import { DataManagementSection } from "./data-management-section"

describe("数据管理备份导出入口", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    exportMock.mockResolvedValue({ success: true, warnings: [], fileCount: 1, totalSize: 32, error: null })
    registryMock.mockResolvedValue({
      p1: { id: "p1", name: "长安夜雨", path: "C:/Novel", lastOpened: 2 },
    })
    selectBackupMock.mockResolvedValue("C:/backup/global-only.zip")
    readManifestMock.mockResolvedValue({
      backupVersion: 2,
      contents: { globalConfig: true, uiPreferences: false, credentials: false },
      projects: [],
    })
    await act(async () => root.render(<DataManagementSection />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  it("用户确认选择后才开始导出", async () => {
    const exportButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "导出备份")!

    await act(async () => exportButton.click())

    expect(document.body.textContent).toContain("选择备份内容")
    expect(exportMock).not.toHaveBeenCalled()

    await act(async () => (document.querySelector('[aria-label="自定义备份"]') as HTMLInputElement).click())
    const confirm = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "开始导出")!
    await act(async () => confirm.click())

    expect(exportMock).toHaveBeenCalledWith({
      includeGlobalConfig: true,
      includeUiPreferences: true,
      includeCredentials: false,
      projects: [{
        id: "p1",
        name: "长安夜雨",
        path: "C:/Novel",
        sections: ["content", "memory", "analysis", "indexes", "trash"],
      }],
    }, expect.any(Function))
  })

  it("明确说明备份可以选择内容且凭据不是固定导出", () => {
    expect(document.body.textContent).toContain("可选择全局配置、项目和数据类别")
    expect(document.body.textContent).toContain("只有勾选 API Key 和其他凭据时")
    expect(document.body.textContent).toContain("恢复备份中包含的全部内容")
  })

  it("选择性导入不含项目的备份时显示中文错误", async () => {
    await act(async () => (document.querySelector('input[value="selective"]') as HTMLInputElement).click())
    const importButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "导入备份")!
    await act(async () => importButton.click())

    expect(document.body.textContent).toContain("该备份不包含可恢复的项目数据")
  })
})

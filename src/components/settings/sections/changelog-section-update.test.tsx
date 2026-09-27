// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DownloadEvent } from "@tauri-apps/plugin-updater"
import { ChangelogSection } from "./changelog-section"
import {
  __setChangelogUpdateCheckerForTest,
  checkForChangelogUpdate,
  downloadChangelogUpdate,
  installChangelogUpdate,
  resetChangelogUpdateSessionForTests,
  type ChangelogUpdatePackage,
} from "@/lib/changelog-update-session"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh" },
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? "",
  }),
}))

vi.mock("@/lib/platform", () => ({
  isTauri: () => true,
}))

vi.mock("@/lib/app-update-support", () => ({
  isAppAutoUpdateSupported: () => true,
  APP_AUTO_UPDATE_UNSUPPORTED_MESSAGE: "当前平台暂不支持应用内自动更新，请前往 GitHub Releases 手动下载安装包。",
  APP_AUTO_UPDATE_RELEASES_URL: "https://github.com/Mochocyang/QMAI/releases",
}))

function createPackage(version: string): ChangelogUpdatePackage {
  return {
    version,
    body: "稍后安装",
    download: vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 10 } })
      onEvent?.({ event: "Progress", data: { chunkLength: 10 } })
      onEvent?.({ event: "Finished" })
    }),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}

function buttonLabels(host: HTMLElement) {
  return Array.from(host.querySelectorAll("button")).map((button) => button.textContent?.trim() ?? "")
}

describe("ChangelogSection update session", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    resetChangelogUpdateSessionForTests()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    resetChangelogUpdateSessionForTests()
  })

  it("离开更新日志再回来仍显示安装和重新下载", async () => {
    const pkg = createPackage("9.9.9")
    __setChangelogUpdateCheckerForTest(async () => pkg)
    await checkForChangelogUpdate()
    await downloadChangelogUpdate()

    await act(async () => {
      root.render(<ChangelogSection />)
    })

    expect(host.textContent).toContain("v9.9.9 已下载完成")
    expect(buttonLabels(host)).toEqual(expect.arrayContaining(["安装", "重新下载"]))

    act(() => {
      root.unmount()
    })
    root = createRoot(host)
    await act(async () => {
      root.render(<ChangelogSection />)
    })

    expect(host.textContent).toContain("v9.9.9 已下载完成")
    expect(buttonLabels(host)).toEqual(expect.arrayContaining(["安装", "重新下载"]))

    pkg.install.mockRejectedValueOnce(new Error("permission denied"))
    await act(async () => {
      await installChangelogUpdate()
    })

    expect(host.textContent).toContain("安装失败：permission denied")
    expect(buttonLabels(host)).toEqual(expect.arrayContaining(["安装", "重新下载"]))
  })
})

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import type { DownloadEvent } from "@tauri-apps/plugin-updater"
import {
  __setChangelogUpdateCheckerForTest,
  checkForChangelogUpdate,
  downloadChangelogUpdate,
  getChangelogUpdateSnapshot,
  installChangelogUpdate,
  redownloadChangelogUpdate,
  resetChangelogUpdateSessionForTests,
  type ChangelogUpdatePackage,
} from "./changelog-update-session"

vi.mock("@/lib/platform", () => ({
  isTauri: () => true,
}))

vi.mock("@/lib/app-update-support", () => ({
  isAppAutoUpdateSupported: () => true,
  APP_AUTO_UPDATE_UNSUPPORTED_MESSAGE: "当前平台暂不支持应用内自动更新，请前往 GitHub Releases 手动下载安装包。",
  APP_AUTO_UPDATE_RELEASES_URL: "https://github.com/Mochocyang/QMAI/releases",
}))

/**
 * 测试里需要拿到 mock 断言/改行为的 API，所以把 ChangelogUpdatePackage 的
 * 三个方法字段显式标注为对应签名的 Mock（仍然满足生产类型契约）。
 */
type ChangelogUpdatePackageMock = ChangelogUpdatePackage & {
  download: Mock<ChangelogUpdatePackage["download"]>
  install: Mock<ChangelogUpdatePackage["install"]>
  close: Mock<ChangelogUpdatePackage["close"]>
}

function createPackage(version: string, body = "修复自动更新"): ChangelogUpdatePackageMock {
  return {
    version,
    body,
    download: vi.fn<(onEvent?: (event: DownloadEvent) => void) => Promise<void>>(async (onEvent) => {
      onEvent?.({ event: "Started", data: { contentLength: 10 } })
      onEvent?.({ event: "Progress", data: { chunkLength: 10 } })
      onEvent?.({ event: "Finished" })
    }),
    install: vi.fn<() => Promise<void>>(async () => undefined),
    close: vi.fn<() => Promise<void>>(async () => undefined),
  }
}

async function downloadVersion(version: string, body?: string): Promise<ChangelogUpdatePackageMock> {
  const pkg = createPackage(version, body)
  __setChangelogUpdateCheckerForTest(async () => pkg)
  await checkForChangelogUpdate()
  await downloadChangelogUpdate()
  return pkg
}

describe("changelog update session", () => {
  beforeEach(() => {
    resetChangelogUpdateSessionForTests()
  })

  afterEach(() => {
    resetChangelogUpdateSessionForTests()
  })

  it("下载完成后离开再进入，快照仍是已下载的版本", async () => {
    await downloadVersion("1.2.0", "可以稍后安装")

    const afterLeave = getChangelogUpdateSnapshot()

    expect(afterLeave.status).toBe("ready")
    expect(afterLeave.latestVersion).toBe("1.2.0")
    expect(afterLeave.updateNotes).toBe("可以稍后安装")
    expect(getChangelogUpdateSnapshot()).toBe(afterLeave)
  })

  it("安装失败后保留安装包，可以再次安装", async () => {
    const pkg = await downloadVersion("1.2.0")
    pkg.install
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockRejectedValueOnce(new Error("permission denied"))

    await installChangelogUpdate()

    expect(getChangelogUpdateSnapshot().status).toBe("ready")
    expect(getChangelogUpdateSnapshot().latestVersion).toBe("1.2.0")
    expect(getChangelogUpdateSnapshot().errorMessage).toBe("安装失败：permission denied")

    await installChangelogUpdate()

    expect(pkg.install).toHaveBeenCalledTimes(2)
    expect(pkg.close).not.toHaveBeenCalled()
    expect(getChangelogUpdateSnapshot().status).toBe("ready")
  })

  it("重新下载失败时仍可安装旧包，成功后关掉旧包", async () => {
    const installed = await downloadVersion("1.2.0", "第一份安装包")
    const failed = createPackage("1.2.0", "重新下载失败的包")
    failed.download.mockRejectedValue(new Error("network error"))
    __setChangelogUpdateCheckerForTest(async () => failed)

    await redownloadChangelogUpdate()

    expect(getChangelogUpdateSnapshot().status).toBe("ready")
    expect(getChangelogUpdateSnapshot().latestVersion).toBe("1.2.0")
    expect(getChangelogUpdateSnapshot().updateNotes).toBe("第一份安装包")
    expect(getChangelogUpdateSnapshot().errorMessage).toBe("重新下载失败：network error")
    expect(installed.close).not.toHaveBeenCalled()
    expect(failed.close).toHaveBeenCalledTimes(1)

    await installChangelogUpdate()
    expect(installed.install).toHaveBeenCalledTimes(1)

    const replacement = createPackage("1.2.0", "新的安装包")
    __setChangelogUpdateCheckerForTest(async () => replacement)
    await redownloadChangelogUpdate()

    expect(installed.close).toHaveBeenCalledTimes(1)
    expect(replacement.close).not.toHaveBeenCalled()
    expect(getChangelogUpdateSnapshot()).toMatchObject({
      status: "ready",
      latestVersion: "1.2.0",
      updateNotes: "新的安装包",
      errorMessage: "",
    })

    await installChangelogUpdate()
    expect(replacement.install).toHaveBeenCalledTimes(1)
    expect(installed.install).toHaveBeenCalledTimes(1)
  })

  it("安装程序拉起并退出当前进程时不记成安装失败", async () => {
    const pkg = await downloadVersion("1.2.0")
    pkg.install.mockRejectedValue(new Error("process exited with code 0"))

    await installChangelogUpdate()

    expect(getChangelogUpdateSnapshot()).toMatchObject({
      status: "ready",
      latestVersion: "1.2.0",
      errorMessage: "",
    })
    expect(pkg.close).not.toHaveBeenCalled()
  })

  it("已下载后再检查，同一版本保留安装包，不同版本才换成待下载", async () => {
    const installed = await downloadVersion("1.2.0", "已下载")
    const sameVersion = createPackage("1.2.0", "同版本的新检查结果")
    __setChangelogUpdateCheckerForTest(async () => sameVersion)

    await checkForChangelogUpdate()

    expect(getChangelogUpdateSnapshot().status).toBe("ready")
    expect(installed.close).not.toHaveBeenCalled()
    expect(sameVersion.close).toHaveBeenCalledTimes(1)

    const newer = createPackage("1.3.0", "另一个版本")
    __setChangelogUpdateCheckerForTest(async () => newer)
    await checkForChangelogUpdate()

    expect(installed.close).toHaveBeenCalledTimes(1)
    expect(getChangelogUpdateSnapshot()).toMatchObject({
      status: "available",
      latestVersion: "1.3.0",
      updateNotes: "另一个版本",
    })
  })
})

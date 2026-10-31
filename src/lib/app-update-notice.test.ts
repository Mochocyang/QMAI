import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 「有更新时自动提醒」开关、更新日志红点、后台预下载状态。
 *
 * 三个状态互相关联，但判断规则很硬：
 *   · 开关只管**弹不弹窗**，默认开启（老用户行为不变）；
 *   · 红点 = 开关关闭 + 确实有新版本；
 *   · 预下载状态只在本进程内有效，不落盘。
 */

const storeValues = new Map<string, unknown>()
const saveMock = vi.fn(async () => undefined)

vi.mock("@/lib/web-store", () => ({
  getStore: async () => ({
    get: async <T>(key: string) => storeValues.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      storeValues.set(key, value)
    },
    delete: async (key: string) => {
      storeValues.delete(key)
    },
    save: saveMock,
  }),
}))

const notice = await import("./app-update-notice")

beforeEach(() => {
  storeValues.clear()
  saveMock.mockClear()
  notice.resetAppUpdateNoticeForTests()
})

describe("自动提醒开关", () => {
  it("没有保存过时默认开启", async () => {
    await expect(notice.loadAppUpdateAutoPrompt()).resolves.toBe(true)
    expect(notice.getAppUpdateAutoPrompt()).toBe(true)
  })

  it("关闭后保存，并能读回关闭状态", async () => {
    await notice.setAppUpdateAutoPrompt(false)

    expect(saveMock).toHaveBeenCalled()
    expect(notice.getAppUpdateAutoPrompt()).toBe(false)
    // 重新加载（模拟下次启动）仍然是关闭
    notice.resetAppUpdateNoticeForTests()
    await expect(notice.loadAppUpdateAutoPrompt()).resolves.toBe(false)
  })
})

describe("更新日志红点", () => {
  it("默认开启时，即使有新版本也不亮红点", async () => {
    await notice.loadAppUpdateAutoPrompt()
    notice.setPendingUpdateVersion("4.1.2")

    expect(notice.hasPendingUpdate()).toBe(false)
  })

  it("关闭提醒后，有新版本才亮红点", async () => {
    await notice.setAppUpdateAutoPrompt(false)
    notice.setPendingUpdateVersion("4.1.2")

    expect(notice.hasPendingUpdate()).toBe(true)
  })

  it("版本被清空（已是最新 / 已处理）后红点消失", async () => {
    await notice.setAppUpdateAutoPrompt(false)
    notice.setPendingUpdateVersion("4.1.2")
    notice.setPendingUpdateVersion(null)

    expect(notice.hasPendingUpdate()).toBe(false)
  })
})

describe("后台预下载状态", () => {
  it("记录完成后的安装包路径，并报告已就绪", () => {
    notice.markPrefetchReady("4.1.2", "C:/data/updates/QMaiWrite-update.exe")

    expect(notice.getAppUpdateNoticeSnapshot().prefetch.status).toBe("ready")
    expect(notice.getAppUpdateNoticeSnapshot().prefetch.version).toBe("4.1.2")
    expect(notice.getPendingUpdatePath()).toBe("C:/data/updates/QMaiWrite-update.exe")
  })

  it("同一版本正在下载时不重复下载", () => {
    notice.markPrefetchDownloading("4.1.2")
    expect(notice.shouldPrefetch("4.1.2")).toBe(false)
  })

  it("同一版本已就绪时不重复下载", () => {
    notice.markPrefetchReady("4.1.2", "C:/data/updates/QMaiWrite-update.exe")
    expect(notice.shouldPrefetch("4.1.2")).toBe(false)
  })

  it("出现更新的版本时要重新下载（新包覆盖旧包）", () => {
    notice.markPrefetchReady("4.1.1", "C:/data/updates/QMaiWrite-update.exe")

    expect(notice.shouldPrefetch("4.1.2")).toBe(true)
  })

  it("预下载失败只记录状态，不亮红点提示以外的东西", () => {
    notice.markPrefetchFailed("4.1.2")

    const snapshot = notice.getAppUpdateNoticeSnapshot()
    expect(snapshot.prefetch.status).toBe("error")
    expect(snapshot.prefetch.version).toBe("4.1.2")
    expect(notice.getPendingUpdatePath()).toBeNull()
  })
})

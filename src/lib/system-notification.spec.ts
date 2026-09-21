import { afterEach, describe, expect, it, vi } from "vitest"
import { isChapterWritingIntent } from "@/lib/novel/task-router"
import {
  buildChapterWritingNotification,
  ensureSystemNotificationPermission,
  notifyChapterWritingOutcome,
  resolveNotificationSound,
  shouldNotifyChapterWriting,
  type SystemNotificationBindings,
} from "./system-notification"

function bindings(overrides: Partial<SystemNotificationBindings> = {}): SystemNotificationBindings {
  return {
    isTauri: () => true,
    isPermissionGranted: async () => true,
    requestPermission: async () => "granted",
    sendNotification: vi.fn(),
    userAgent: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    platform: () => "Win32",
    warn: vi.fn(),
    ...overrides,
  }
}

describe("resolveNotificationSound", () => {
  it("uses Ping on macOS", () => {
    expect(resolveNotificationSound(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "MacIntel",
    )).toBe("Ping")
  })

  it("uses Default on Windows", () => {
    expect(resolveNotificationSound(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Win32",
    )).toBe("Default")
  })
})

describe("shouldNotifyChapterWriting", () => {
  it("allows chapter writing intents", () => {
    expect(isChapterWritingIntent("write_chapter")).toBe(true)
    expect(isChapterWritingIntent("continue_chapter")).toBe(true)
    expect(isChapterWritingIntent("rewrite_chapter")).toBe(true)
    expect(isChapterWritingIntent("polish_chapter")).toBe(true)
    expect(shouldNotifyChapterWriting({ intent: "write_chapter" })).toBe(true)
  })

  it("skips non-writing intents and plan-only turns", () => {
    expect(isChapterWritingIntent("generate_outline")).toBe(false)
    expect(isChapterWritingIntent("general_chat")).toBe(false)
    expect(shouldNotifyChapterWriting({ intent: "generate_outline" })).toBe(false)
    expect(shouldNotifyChapterWriting({ intent: "write_chapter", planOnly: true })).toBe(false)
  })
})

describe("buildChapterWritingNotification", () => {
  it("includes chapter number on success", () => {
    expect(buildChapterWritingNotification({ ok: true, chapterNumber: 8 })).toEqual({
      title: "章节写作完成",
      body: "第 8 章已完成",
    })
  })

  it("truncates failure body", () => {
    const error = "x".repeat(140)
    const result = buildChapterWritingNotification({ ok: false, error })
    expect(result.title).toBe("章节写作失败")
    expect(result.body).toHaveLength(121)
    expect(result.body.endsWith("…")).toBe(true)
  })
})

describe("ensureSystemNotificationPermission", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("is a no-op outside Tauri", async () => {
    const testBindings = bindings({
      isTauri: () => false,
      isPermissionGranted: vi.fn(async () => true),
    })
    await expect(ensureSystemNotificationPermission(testBindings)).resolves.toBe(false)
    expect(testBindings.isPermissionGranted).not.toHaveBeenCalled()
  })

  it("requests permission when not granted", async () => {
    const testBindings = bindings({
      isPermissionGranted: vi.fn(async () => false),
      requestPermission: vi.fn(async () => "granted"),
    })
    await expect(ensureSystemNotificationPermission(testBindings)).resolves.toBe(true)
    expect(testBindings.requestPermission).toHaveBeenCalledTimes(1)
  })
})

describe("notifyChapterWritingOutcome", () => {
  it("does not send outside Tauri", async () => {
    const testBindings = bindings({ isTauri: () => false })
    await notifyChapterWritingOutcome({ intent: "write_chapter", ok: true }, testBindings)
    expect(testBindings.sendNotification).not.toHaveBeenCalled()
  })

  it("does not send when permission is denied", async () => {
    const testBindings = bindings({
      isPermissionGranted: async () => false,
      requestPermission: async () => "denied",
    })
    await notifyChapterWritingOutcome({ intent: "write_chapter", ok: true }, testBindings)
    expect(testBindings.sendNotification).not.toHaveBeenCalled()
  })

  it("sends a Windows notification with Default sound", async () => {
    const testBindings = bindings()
    await notifyChapterWritingOutcome({
      intent: "write_chapter",
      ok: true,
      chapterNumber: 3,
    }, testBindings)
    expect(testBindings.sendNotification).toHaveBeenCalledWith({
      title: "章节写作完成",
      body: "第 3 章已完成",
      sound: "Default",
    })
  })

  it("sends a macOS notification with Ping sound", async () => {
    const testBindings = bindings({
      userAgent: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      platform: () => "MacIntel",
    })
    await notifyChapterWritingOutcome({
      intent: "continue_chapter",
      ok: false,
      error: "扩写后字数不足",
    }, testBindings)
    expect(testBindings.sendNotification).toHaveBeenCalledWith({
      title: "章节写作失败",
      body: "扩写后字数不足",
      sound: "Ping",
    })
  })

  it("does not send for plan-only chapter writing", async () => {
    const testBindings = bindings()
    await notifyChapterWritingOutcome({
      intent: "write_chapter",
      planOnly: true,
      ok: true,
    }, testBindings)
    expect(testBindings.sendNotification).not.toHaveBeenCalled()
  })

  it("warns and does not throw when sending fails", async () => {
    const testBindings = bindings({
      sendNotification: () => {
        throw new Error("plugin missing")
      },
    })
    await expect(notifyChapterWritingOutcome({
      intent: "write_chapter",
      ok: true,
    }, testBindings)).resolves.toBeUndefined()
    expect(testBindings.warn).toHaveBeenCalled()
  })
})

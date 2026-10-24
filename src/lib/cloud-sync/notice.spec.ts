import { describe, expect, it } from "vitest"

import { noticeActionLabel, resolveNotice } from "./notice"

describe("resolveNotice", () => {
  it("授权过期 → 重新登录动作", () => {
    const copy = resolveNotice("auth.expired")
    expect(copy.message).toContain("过期")
    expect(copy.action).toBe("relogin")
  })

  it("未登录 → 去登录动作", () => {
    const copy = resolveNotice("auth.required")
    expect(copy.action).toBe("settings")
    expect(copy.message).toContain("登录")
  })

  it("配额类错误讲清楚是频率限制，不是网络问题", () => {
    expect(resolveNotice("quota.rate-limit").message).toContain("过于频繁")
    expect(resolveNotice("quota.no-permission").message).toContain("权限")
  })

  it("用户数上限错误有独立文案", () => {
    expect(resolveNotice("auth.user-limit").message).toContain("上限")
  })

  it("网络与存储错误各自可读", () => {
    expect(resolveNotice("net.offline").message).toContain("网络")
    expect(resolveNotice("net.timeout").message).toContain("超时")
    expect(resolveNotice("storage.full").message).toContain("空间不足")
  })

  it("百度业务码 -9 / 111 走可读文案而不是原始错误", () => {
    expect(resolveNotice("remote.missing").message).toContain("同步目录")
    expect(resolveNotice("remote.busy").message).toContain("稍后")
  })

  it("端口占用给出具体端口号", () => {
    expect(resolveNotice("callback.port-in-use").message).toContain("17653")
  })

  it("冲突带数量时把数字写进文案", () => {
    expect(resolveNotice("conflict.detected", { count: 2 }).message).toContain("2 个文件")
    expect(resolveNotice("conflict.detected").message).toContain("两边都改过")
  })

  it("没有错误码时给通用文案", () => {
    const copy = resolveNotice(undefined)
    expect(copy.message).toContain("稍后重试")
    expect(copy.action).toBe("detail")
  })

  it("WebDAV 失败文案能指向具体动作，而不是只说连不上", () => {
    expect(resolveNotice("webdav.auth").message).toContain("应用密码")
    expect(resolveNotice("webdav.read-only").message).toContain("写入权限")
    expect(resolveNotice("webdav.reconnect").message).toContain("重新输入")
  })

  it("百度的 errno 会翻译成一句人话，不把码甩给用户", () => {
    const copy = resolveNotice("baidu.errno:-7")
    expect(copy.message).toContain("百度网盘接口报错")
    expect(copy.message).toContain("-7")
  })

  it("百度接口异常也走同一套兜底", () => {
    expect(resolveNotice("baidu.status:500").message).toContain("500")
    expect(resolveNotice("remote.too-large").message).toContain("太大")
  })

  it("服务端状态码拼在码后面时不把裸码丢给用户", () => {
    const copy = resolveNotice("webdav.status:502")
    expect(copy.message).toContain("502")
    expect(copy.message).not.toContain("webdav.status")
  })

  it("未知错误码必须带上码，便于用户反馈", () => {
    const copy = resolveNotice("mystery.code")
    expect(copy.message).toContain("mystery.code")
    expect(copy.action).toBe("detail")
  })

  it("所有已知码都不会直出英文原文", () => {
    const codes = [
      "auth.required",
      "auth.expired",
      "auth.revoked",
      "auth.user-limit",
      "quota.rate-limit",
      "quota.no-permission",
      "net.offline",
      "net.timeout",
      "storage.full",
      "remote.missing",
      "remote.busy",
      "local.locked",
      "callback.port-in-use",
      "conflict.detected",
      "webdav.auth",
      "webdav.not-found",
      "webdav.read-only",
      "webdav.tls",
      "webdav.url",
      "webdav.reconnect",
      "remote.bad-name",
      "remote.exists",
      "remote.too-large",
      "baidu.bad-response",
      "baidu.no-uploadid",
    ]
    for (const code of codes) {
      expect(resolveNotice(code).message).not.toMatch(/error|failed|exception/i)
    }
  })
})

describe("noticeActionLabel", () => {
  it("动作有中文按钮名", () => {
    expect(noticeActionLabel("relogin")).toBe("重新登录")
    expect(noticeActionLabel("detail")).toBe("查看详情")
    expect(noticeActionLabel("settings")).toBe("去登录")
    expect(noticeActionLabel(null)).toBeNull()
  })
})

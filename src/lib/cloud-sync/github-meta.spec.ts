import { describe, expect, it } from "vitest"

import { CLOUD_PROVIDERS, isProviderAvailable, providerLabel, providerMeta } from "./providers"
import { resolveNotice } from "./notice"

describe("云同步 · GitHub 元数据", () => {
  it("三张卡片：百度这一版不出现，其余都可用", () => {
    expect(CLOUD_PROVIDERS.map((provider) => provider.id)).toEqual(["webdav", "github", "folder"])
    expect(isProviderAvailable("github")).toBe(true)
    expect(isProviderAvailable("webdav")).toBe(true)
    expect(isProviderAvailable("folder")).toBe(true)
  })

  it("百度不在列表里，但名字仍能解析", () => {
    expect(isProviderAvailable("baidu")).toBe(false) // 不在列表里 → 不可用
    expect(providerLabel("baidu")).toBe("百度网盘") // 但名字仍认得（历史配置兼容）
  })

  it("WebDAV 卡片写的是「坚果云」", () => {
    expect(providerLabel("webdav")).toBe("坚果云")
  })

  it("GitHub 走设备流，网盘本地文件夹的名字是改过的那个", () => {
    expect(providerMeta("github")?.login).toBe("device")
    expect(providerLabel("github")).toBe("GitHub")
    expect(providerLabel("folder")).toBe("网盘本地文件夹")
    expect(providerLabel(null)).toBe("未选择网盘")
  })

  it("公开仓库的错误必须说清「会被所有人看到」", () => {
    const notice = resolveNotice("github.repo-public")
    expect(notice.message).toContain("公开")
    expect(notice.message).toContain("私有")
  })

  it("网络类失败给的是人话，不是 github.network", () => {
    expect(resolveNotice("github.network").message).toContain("连不上 GitHub")
    expect(resolveNotice("github.rate-limited").message).toContain("请求频率")
    expect(resolveNotice("github.not-configured").message).toContain("还没绑定 GitHub 应用")
  })
})


describe("带冒号后缀的错误码也要给出人话", () => {
  it("github.auth:Bad credentials 不把英文原话丢给用户", () => {
    const notice = resolveNotice("github.auth:Bad credentials")
    expect(notice.message).not.toContain("Bad credentials")
    expect(notice.message).toContain("GitHub")
    // 必须能引导用户去处理（重新连接 / 去设置）
    expect(["relogin", "settings"]).toContain(notice.action)
  })

  it("webdav.status:502 仍然走它自己的专用文案", () => {
    expect(resolveNotice("webdav.status:502").message).toContain("异常状态")
  })

  it("baidu.errno 仍然走它自己的专用文案", () => {
    expect(resolveNotice("baidu.errno:-6").message).toContain("百度网盘接口报错")
  })
})

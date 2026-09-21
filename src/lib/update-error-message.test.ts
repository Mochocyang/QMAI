import { describe, expect, it } from "vitest"
import { formatUpdateErrorMessage } from "./update-error-message"

describe("formatUpdateErrorMessage", () => {
  it("explains invalid remote release json in Chinese", () => {
    expect(
      formatUpdateErrorMessage(new Error("Could not fetch a valid release JSON from the remote")),
    ).toBe(
      "检查更新失败：没有从更新服务器拿到有效的版本信息。请先确认网络可以访问 GitHub，若未启用代理请关闭系统或软件代理后重试。",
    )
  })

  it("keeps unknown update errors visible", () => {
    expect(formatUpdateErrorMessage(new Error("network timeout"))).toBe("检查更新失败：network timeout")
  })
})

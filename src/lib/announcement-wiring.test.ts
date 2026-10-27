import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 公告功能的接线守卫。
 *
 * 为什么需要它 —— 与 analytics-wiring.test.ts 是同一场事故的教训：
 * 启动调用被整块删掉之后，模块逻辑仍然完好、单测全绿，但功能已经死了，
 * 表现只是「公告永远是 0 条 / 点铃铛没反应」，没人会发现。
 * 所以这里断言的是**接线本身**，不是内部行为。
 */

const SRC = resolve(__dirname, "..")
const appSource = readFileSync(resolve(SRC, "App.tsx"), "utf8")
const bellSource = readFileSync(resolve(SRC, "components/layout/announcement-bell.tsx"), "utf8")

describe("公告功能的接线", () => {
  it("启动时读缓存并拉取公告", () => {
    expect(appSource).toContain('from "@/stores/announcement-store"')
    expect(appSource).toMatch(/useAnnouncementStore\.getState\(\)\.hydrate\(\)/)
    expect(appSource).toMatch(/useAnnouncementStore\.getState\(\)\.refresh\(\)/)
  })

  it("弹窗挂在 App 根部且只挂一次", () => {
    expect(appSource).toContain('from "@/components/announcements/announcement-dialog"')
    expect(appSource.match(/<AnnouncementDialog \/>/g) ?? []).toHaveLength(1)
  })

  it("侧栏底栏有铃铛入口，且铃铛不自己渲染弹窗", () => {
    const bottomActions = readFileSync(resolve(SRC, "components/layout/sidebar-bottom-actions.tsx"), "utf8")
    expect(bottomActions).toContain("<AnnouncementBell />")
    // 底栏被五个面板共用，铃铛里再放弹窗会叠出多层遮罩。
    expect(bellSource).not.toContain("AnnouncementDialog")
  })
})

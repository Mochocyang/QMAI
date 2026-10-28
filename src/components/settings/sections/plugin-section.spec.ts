// @vitest-environment jsdom
/**
 * 插件卡片上「设置」入口的判据（纯函数层，不挂载整页）。
 *
 * 这条判据的三个方向都必须挡住：
 *   - 只有 `preview.hasConfig === true` 才显示按钮（否则用户点进去看到空表单）；
 *   - `preview` 缺失/形状不认识时**不显示**（Rust 侧还没补字段时的安全降级）；
 *   - `hasConfig: "true"`（字符串）不算 —— 第三方清单里的脏数据不该换来一个假入口。
 */
import { describe, expect, it } from "vitest"
import { PROCESS_STATE_BADGES, enableConfirmTone, hasPluginConfig, previewConfigSchema } from "./plugin-section"

describe("hasPluginConfig", () => {
  it("preview.hasConfig === true 才显示设置入口", () => {
    expect(hasPluginConfig({ preview: { hasConfig: true } })).toBe(true)
  })

  it("没有 preview / 形状不认识 / 非布尔真值 → 不显示", () => {
    expect(hasPluginConfig({ preview: undefined })).toBe(false)
    expect(hasPluginConfig({ preview: null })).toBe(false)
    expect(hasPluginConfig({ preview: [] })).toBe(false)
    expect(hasPluginConfig({ preview: "hasConfig" })).toBe(false)
    expect(hasPluginConfig({ preview: {} })).toBe(false)
    expect(hasPluginConfig({ preview: { hasConfig: "true" } })).toBe(false)
    expect(hasPluginConfig({ preview: { hasConfig: false } })).toBe(false)
  })
})

describe("previewConfigSchema", () => {
  it("取出 preview.configSchema", () => {
    const schema = { type: "object", properties: { apiKey: { type: "string" } } }
    expect(previewConfigSchema({ preview: { hasConfig: true, configSchema: schema } })).toBe(schema)
  })

  it("缺失或 preview 不是对象时返回 undefined（ConfigForm 会显示「没有可配置项」）", () => {
    expect(previewConfigSchema({ preview: undefined })).toBeUndefined()
    expect(previewConfigSchema({ preview: {} })).toBeUndefined()
    expect(previewConfigSchema({ preview: [1, 2] })).toBeUndefined()
  })
})

/**
 * `declarative`（Rust `1310f37a` 起）必须有一枚**自己的**徽章。
 *
 * 这条测试守的是那个已经踩过的坑：缺键时 `?? stopped` 兜底不崩，界面照渲染，
 * 只是把"不需要进程"错报成"已停止" —— 用户会以为启用失败。所以断言的重点不是
 * "有标签"，而是"颜色不能与停止态相同"。
 */
describe("PROCESS_STATE_BADGES.declarative", () => {
  it("有独立标签，且不会被误读成停止", () => {
    const badge = PROCESS_STATE_BADGES.declarative
    expect(badge).toBeDefined()
    expect(badge.label.trim()).not.toBe("")
    expect(badge.label).not.toBe(PROCESS_STATE_BADGES.stopped.label)
  })

  it("配色与 stopped 不同，也不是纯灰底（灰 = 没跑起来的语义）", () => {
    expect(PROCESS_STATE_BADGES.declarative.className).not.toBe(
      PROCESS_STATE_BADGES.stopped.className,
    )
    // 停止态用 bg-muted / text-muted-foreground；声明式一档不许复用它们。
    expect(PROCESS_STATE_BADGES.declarative.className).not.toContain("bg-muted")
    expect(PROCESS_STATE_BADGES.declarative.className).not.toContain("text-muted-foreground")
  })

  it("六个进程态都还在，union 加了 declarative 也没顺手删旧的", () => {
    expect(Object.keys(PROCESS_STATE_BADGES).sort()).toEqual(
      ["crashed", "declarative", "disabled_by_crash", "failed", "running", "starting", "stopped"].sort(),
    )
  })
})

/**
 * 启用确认层的三档：provider（最高危）> default（有工具）> declarative（纯声明）。
 * 档位判据只读 `plugins_list` 的字段，缺字段按"没有该项能力"处理。
 */
describe("enableConfirmTone", () => {
  it("声明了 provider → provider 档（哪怕同时有工具）", () => {
    expect(enableConfirmTone({ providerIds: ["wb-connect"], toolCount: 3 })).toBe("provider")
    expect(enableConfirmTone({ providerIds: ["wb-connect"], toolCount: 0 })).toBe("provider")
  })

  it("没有 provider 但有工具 → default 档", () => {
    expect(enableConfirmTone({ providerIds: [], toolCount: 2 })).toBe("default")
    expect(enableConfirmTone({ providerIds: undefined, toolCount: 1 })).toBe("default")
  })

  it("既没有 provider 也没有工具 → 最轻的 declarative 档", () => {
    expect(enableConfirmTone({ providerIds: [], toolCount: 0 })).toBe("declarative")
    expect(enableConfirmTone({ providerIds: undefined, toolCount: 0 })).toBe("declarative")
    // 空数组与缺失同义：Rust 侧两种都可能出现，不能一个走 default 一个走 declarative。
    expect(enableConfirmTone({ providerIds: undefined, toolCount: 0 })).toBe(
      enableConfirmTone({ providerIds: [], toolCount: 0 }),
    )
  })
})

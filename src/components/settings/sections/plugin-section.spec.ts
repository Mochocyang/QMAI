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
import { hasPluginConfig, previewConfigSchema } from "./plugin-section"

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

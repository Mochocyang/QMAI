/**
 * 设置页「插件 provider」运行期卡片的形状测试（T4）。
 *
 * 只测「视图 → preset」这一步，因为这里有两个容易错位、且错了很难发现的点：
 *   1. `preset.id` / `preset.provider` 必须是 **provider id**（`providerConfigs` 的键、
 *      模型复合键 `providerId/modelId` 的前缀，设计 D1）；
 *   2. 未就绪的 provider 也必须得到一张卡片（灰显 + lastError），不能从列表里消失。
 * 真正的渲染行为在 `llm-provider-section.test.tsx` 那条链路里由人工验收覆盖。
 */
import { describe, expect, it } from "vitest"
import { toPluginProviderPreset } from "./plugin-provider-card"
import type { PluginProviderView } from "@/lib/plugins/types"

function view(overrides: Partial<PluginProviderView> = {}): PluginProviderView {
  return {
    pluginId: "wb-plugin",
    providerId: "wb-connect",
    name: "WorkBuddy 直连",
    baseUrl: "http://127.0.0.1:43210",
    authKind: "none",
    capabilities: [],
    models: [
      {
        id: "glm-5.3",
        name: "GLM-5.3",
        maxInputTokens: 1_000_000,
        maxOutputTokens: 8192,
        supportsToolCall: true,
        supportsVision: false,
      },
    ],
    ready: true,
    ...overrides,
  }
}

describe("toPluginProviderPreset", () => {
  it("用 provider id 当 preset id 与 provider，并带上插件来源", () => {
    const preset = toPluginProviderPreset(view())

    expect(preset.id).toBe("wb-connect")
    expect(preset.provider).toBe("wb-connect")
    expect(preset.label).toBe("WorkBuddy 直连")
    // 卡片小字：用户必须能看出「谁在收我的数据」（设计 §7 第 3 条）。
    expect(preset.hint).toBe("来自插件 wb-plugin")
    expect(preset.pluginId).toBe("wb-plugin")
    expect(preset.ready).toBe(true)
    expect(preset.models).toHaveLength(1)
  })

  it("名字为空时退回 provider id，避免出现一张没有标题的卡片", () => {
    expect(toPluginProviderPreset(view({ name: "" })).label).toBe("wb-connect")
  })

  it("未就绪的 provider 仍然产出卡片，并带上失败原因", () => {
    const preset = toPluginProviderPreset(view({ ready: false, lastError: "健康检查超时（10s）" }))

    expect(preset.ready).toBe(false)
    expect(preset.lastError).toBe("健康检查超时（10s）")
  })
})

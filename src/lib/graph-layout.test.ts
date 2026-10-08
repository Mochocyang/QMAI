import { describe, expect, it } from "vitest"
import { GRAPH_LAYOUT_SETTINGS, getGraphVisualSettings } from "./graph-layout"

// 说明：模块级常量 GRAPH_VISUAL_SETTINGS 于提交 01aab5f（refactor(cleanup):
// 收口测试专用旧模块和未使用导出，2026-08-24）被摘掉 export，但它仍然存活，
// 由导出的 getGraphVisualSettings() 在 nodeCount < 100 档位原样返回
// （src/lib/graph-layout.ts:49-54），生产端 graph-view.tsx 亦经该函数取值。
// 故此处改为经公开函数取得同一批参数值来验证，断言强度不变。
// 待恢复：src/lib/graph-layout.ts 中 GRAPH_VISUAL_SETTINGS 的 export（未改生产代码）。

describe("图谱布局参数", () => {
  it("使用更分散的布局与更克制的视觉参数", () => {
    // nodeCount < 100 档位即模块级默认视觉参数（GRAPH_VISUAL_SETTINGS）
    const defaultVisualSettings = getGraphVisualSettings(0)

    expect(GRAPH_LAYOUT_SETTINGS.scalingRatio).toBeGreaterThanOrEqual(4)
    expect(GRAPH_LAYOUT_SETTINGS.gravity).toBeLessThanOrEqual(0.22)
    expect(defaultVisualSettings.baseNodeSize).toBeLessThanOrEqual(7)
    expect(defaultVisualSettings.maxNodeSize).toBeLessThanOrEqual(22)
    expect(defaultVisualSettings.maxEdgeSize).toBeLessThanOrEqual(2.2)
  })
})

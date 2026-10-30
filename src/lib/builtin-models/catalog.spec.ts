import { describe, expect, it } from "vitest"
import { defaultSelectedModelIds, describeBuiltinModel, sortBuiltinModelIds } from "./catalog"

describe("describeBuiltinModel", () => {
  it("三个对外名都有中文展示名与定位", () => {
    expect(describeBuiltinModel("qmai-standard").label).toBe("青幕标准版")
    expect(describeBuiltinModel("qmai-long").label).toBe("青幕长文版")
    expect(describeBuiltinModel("qmai-fast").label).toBe("青幕轻量版")
    expect(describeBuiltinModel("qmai-standard").recommended).toBe(true)
  })

  it("上下文不低于 QMAI 的 204800 下限", () => {
    for (const id of ["qmai-standard", "qmai-long", "qmai-fast"]) {
      expect(describeBuiltinModel(id).contextSize).toBeGreaterThanOrEqual(204800)
    }
  })

  it("未知模型有兜底，不抛错", () => {
    const meta = describeBuiltinModel("some-unknown-model")
    expect(meta.label).toBe("some-unknown-model")
    expect(meta.contextSize).toBeGreaterThanOrEqual(204800)
    expect(meta.recommended).toBe(false)
  })

  it("旧网关残留的名字映射到新的展示名（老配置不显示裸 id）", () => {
    expect(describeBuiltinModel("kimi-k3").label).toBe("青幕长文版")
    expect(describeBuiltinModel("glm-4.7-flash").label).toBe("青幕轻量版")
  })

  it("返回的 id 始终是传入的 id（调用方要靠它对回模型）", () => {
    expect(describeBuiltinModel("kimi-k3").id).toBe("kimi-k3")
  })
})

describe("sortBuiltinModelIds", () => {
  it("推荐的排前面，同权重按固定顺序，最后字母序；并去重", () => {
    const sorted = sortBuiltinModelIds(["zeta", "qmai-fast", "qmai-standard", "qmai-fast"])
    expect(sorted[0]).toBe("qmai-standard")
    expect(sorted[1]).toBe("qmai-fast")
    expect(sorted).toHaveLength(3)
    expect(sorted[sorted.length - 1]).toBe("zeta")
  })
})

describe("defaultSelectedModelIds", () => {
  it("优先选推荐模型，且按网关原顺序（不重排）", () => {
    expect(defaultSelectedModelIds(["zeta", "qmai-long", "qmai-standard"])).toEqual([
      "qmai-long",
      "qmai-standard",
    ])
  })

  it("一个推荐都没有时退回前三个", () => {
    expect(defaultSelectedModelIds(["a", "b", "c", "d"])).toEqual(["a", "b", "c"])
  })
})

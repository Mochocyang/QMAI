import { describe, expect, it } from "vitest"
import {
  SCENARIO_MODERATOR_TONE,
  SCENARIO_SPEAKER_TONES,
  scenarioAvatarInitial,
  scenarioSpeakerTone,
  scenarioSpeakerToneIndex,
} from "./scenario-avatar"

describe("scenarioAvatarInitial", () => {
  it("取中文名字的第一个字", () => {
    expect(scenarioAvatarInitial("沈砚")).toBe("沈")
    expect(scenarioAvatarInitial("诸葛亮")).toBe("诸")
  })

  it("去掉首尾空白后再取", () => {
    expect(scenarioAvatarInitial("  林清越  ")).toBe("林")
  })

  it("空名与纯空白回退为问号，不返回空串", () => {
    expect(scenarioAvatarInitial("")).toBe("?")
    expect(scenarioAvatarInitial("   ")).toBe("?")
  })

  it("不把代理对（emoji）截成半个字符", () => {
    expect(scenarioAvatarInitial("🐉龙")).toBe("🐉")
  })
})

describe("scenarioSpeakerToneIndex", () => {
  it("同一个名字永远落在同一个下标", () => {
    expect(scenarioSpeakerToneIndex("沈砚")).toBe(scenarioSpeakerToneIndex("沈砚"))
  })

  it("下标始终落在色板范围内", () => {
    const names = ["沈砚", "林清越", "苏九", "阿明", "A", "b", "张三丰", "🐉", ""]
    for (const name of names) {
      const index = scenarioSpeakerToneIndex(name)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(SCENARIO_SPEAKER_TONES.length)
    }
  })

  it("一组常见名字不会被全部压到同一个颜色", () => {
    const names = ["沈砚", "林清越", "苏九", "阿明", "赵六", "钱七"]
    const used = new Set(names.map((name) => scenarioSpeakerToneIndex(name)))
    expect(used.size).toBeGreaterThan(1)
  })
})

describe("scenarioSpeakerTone", () => {
  it("主持人用固定样式，不参与哈希", () => {
    expect(scenarioSpeakerTone("沈砚", true)).toBe(SCENARIO_MODERATOR_TONE)
    expect(scenarioSpeakerTone("林清越", true)).toBe(SCENARIO_MODERATOR_TONE)
  })

  it("相同 seed 得到同样的配色", () => {
    expect(scenarioSpeakerTone("沈砚")).toEqual(scenarioSpeakerTone("沈砚"))
  })

  it("色板每一项都有写死的头像与名字类名", () => {
    for (const tone of SCENARIO_SPEAKER_TONES) {
      expect(tone.avatar.length).toBeGreaterThan(0)
      expect(tone.name.length).toBeGreaterThan(0)
    }
  })
})

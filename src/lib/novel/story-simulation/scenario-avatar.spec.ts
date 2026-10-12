import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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

describe("色板类名的字面量契约（源码级）", () => {
  // 为什么必须读源码：`bg-${"rose"}-500/15` 运行时求值结果与字面量
  // "bg-rose-500/15" 完全相同，任何值断言都发现不了动态拼接。
  // 但 Tailwind v4 的内容扫描只认源码里的字面量，拼接出来的类名不会进产物 CSS。
  // 所以这里直接检查源码文本：色板区域不允许出现反引号、${ 插值、字面量拼接。
  it("发言人色板与主持人配色的源码区域只含字面量类名，没有模板字符串或字符串拼接", () => {
    const source = readFileSync(resolve(__dirname, "scenario-avatar.ts"), "utf8")

    const regions = [
      {
        label: "SCENARIO_SPEAKER_TONES",
        start: "export const SCENARIO_SPEAKER_TONES",
        end: "SCENARIO_MODERATOR_TONE",
      },
      {
        label: "SCENARIO_MODERATOR_TONE",
        start: "export const SCENARIO_MODERATOR_TONE",
        end: "export function scenarioSpeakerToneIndex",
      },
    ]

    for (const region of regions) {
      const start = source.indexOf(region.start)
      // 找不到边界标记就直接失败：否则切片会是空串，下面的断言会「假通过」
      expect(start, `源码里没有找到 ${region.label} 的定义`).toBeGreaterThanOrEqual(0)

      const end = source.indexOf(region.end, start + region.start.length)
      expect(end, `源码里没有找到 ${region.label} 的结束标记 ${region.end}`).toBeGreaterThan(
        start,
      )

      const text = source.slice(start, end)

      expect(
        text,
        `${region.label} 区域内出现反引号，说明类名是模板字符串拼出来的，Tailwind 扫不到`,
      ).not.toContain("`")
      expect(
        text,
        `${region.label} 区域内出现插值拼接，Tailwind v4 无法把它收集进产物 CSS`,
      ).not.toContain("${")
      expect(
        text,
        `${region.label} 区域内出现字面量相加，Tailwind v4 无法把它收集进产物 CSS`,
      ).not.toMatch(/["']\s*\+\s*["']/)
    }
  })
})

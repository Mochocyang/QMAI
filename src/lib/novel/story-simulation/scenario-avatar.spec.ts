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

  it("缺字段的脏数据（undefined / null）回退为问号，不抛 TypeError", () => {
    // 签名上是 string，但持久化的情景 JSON 只校验了 messages 是数组、
    // 不逐条校验每个字段（见 scenario-store 的 loadScenarios）。旧数据或手工
    // 改过的文件里缺 speakerName 键时，渲染气泡就会拿到 undefined。
    expect(scenarioAvatarInitial(undefined as unknown as string)).toBe("?")
    expect(scenarioAvatarInitial(null as unknown as string)).toBe("?")
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

  it("带空白的 seed 与已规范化的 seed 落在同一个下标", () => {
    expect(scenarioSpeakerToneIndex("  沈砚  ")).toBe(scenarioSpeakerToneIndex("沈砚"))
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

  it("色板每一项的头像与名字类名都非空", () => {
    for (const tone of SCENARIO_SPEAKER_TONES) {
      expect(tone.avatarClass.length).toBeGreaterThan(0)
      expect(tone.nameClass.length).toBeGreaterThan(0)
    }
  })

  it("seed 是脏数据（undefined / null / 空串）时仍返回一个合法配色，不抛 TypeError", () => {
    // 与 scenarioAvatarInitial 同一个原因：speakerId 在脏持久化数据里可能整个键
    // 都不存在。房间视图渲染每个气泡都要调这里，一抛就是整屏白。
    for (const seed of [undefined, null, ""] as unknown as string[]) {
      const tone = scenarioSpeakerTone(seed, false)
      expect(SCENARIO_SPEAKER_TONES).toContain(tone)
      expect(tone.avatarClass.length).toBeGreaterThan(0)
      expect(tone.nameClass.length).toBeGreaterThan(0)
    }
  })

  it("不同角色经公开入口拿到不同配色，而不是全被压成同一个色", () => {
    // 用互不撞下标的 5 个名字；注意「钱七」与「沈砚」撞下标，不能进这组
    const used = new Set(
      ["沈砚", "林清越", "苏九", "阿明", "赵六"].map(
        (id) => scenarioSpeakerTone(id).nameClass,
      ),
    )
    expect(used.size).toBeGreaterThan(1)
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

      // 先剥掉注释：散文注释里出现反引号或 ${ 是正常的说明写法，
      // 不该因为注释而误红；这个用例要守的是代码。
      const text = source
        .slice(start, end)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")

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
        `${region.label} 区域内出现字符串相加拼类名，Tailwind v4 无法把它收集进产物 CSS`,
      ).not.toMatch(/["'`]\s*\+|\+\s*["'`]/)
    }
  })
})

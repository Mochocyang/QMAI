/**
 * 设定类专属卡的「分区契约」测试。
 *
 * 目的：分区清单分散在四处（prompt 规则 / SKILL.md / SETTING_OUTLINE_SPECS /
 * SETTING_PROFILE_STANDARD.md），任何一处漏改都会让 AI 按旧清单输出。
 * 这里锁定规格表的分区数与语义样式映射，作为四处同步的锚点。
 */

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { SETTING_OUTLINE_SPECS } from "./setting-outline-template"
import { applyDocumentAppearance } from "@/lib/html-document-appearance"
import { profileSectionExtraClass, type ProfileDocument } from "./profile-document"
import { renderGoldenFingerProfileHtml } from "./golden-finger-template"
import { renderBackgroundProfileHtml } from "./background-setting-template"
import { renderGeographyProfileHtml } from "./geography-setting-template"
import { renderLocationProfileHtml } from "./location-setting-template"
import { renderForeshadowingProfileHtml } from "./foreshadowing-plan-template"

const SKILLS_DIR = resolve(process.cwd(), "skills/SkillHub/SheDingSkill")

function specById(id: string) {
  const spec = SETTING_OUTLINE_SPECS.find((item) => item.id === id)
  if (!spec) throw new Error(`缺少分项规格：${id}`)
  return spec
}

/** 用分区标题列表造一份档案，逐个标题一条 kv 条目。 */
function docWithSections(name: string, tag: string, headings: string[]): ProfileDocument {
  return {
    name,
    tag,
    tagline: "测试定位",
    sections: headings.map((heading) => ({
      kind: "kv" as const,
      heading,
      items: [{ label: "示例", text: "内容" }],
    })),
  }
}

describe("设定分项分区契约", () => {
  it("五类专属卡各写满 12 个分区", () => {
    for (const id of [
      "goldenFinger",
      "backgroundSetting",
      "geographySetting",
      "locationsOutline",
      "foreshadowingPlan",
    ]) {
      const spec = specById(id)
      expect(spec.sections, `${id} 分区数`).toHaveLength(12)
      // 分区标题不得重复
      expect(new Set(spec.sections.map((s) => s.heading)).size, `${id} 分区标题去重后`).toBe(12)
    }
  })

  it("金手指分区清单与语义样式映射", () => {
    const headings = specById("goldenFinger").sections.map((s) => s.heading)
    expect(headings).toEqual([
      "能力概述",
      "获取与绑定",
      "机制与规则",
      "已解锁能力",
      "能力分支与升级树",
      "系统任务与使用史",
      "边界与代价",
      "冷却与风险",
      "反制与漏洞",
      "成长节奏",
      "剧情作用",
      "防崩坏写作约束",
    ])
    // 已解锁能力 / 系统任务与使用史 → 系统面板样式
    expect(profileSectionExtraClass("已解锁能力")).toContain("unlock")
    expect(profileSectionExtraClass("系统任务与使用史")).toContain("unlock")
    // 代价 / 风险 / 反制 / 约束 → 危险色矩阵
    expect(profileSectionExtraClass("边界与代价")).toContain("matrix")
    expect(profileSectionExtraClass("冷却与风险")).toContain("matrix")
    expect(profileSectionExtraClass("反制与漏洞")).toContain("matrix")
  })

  it("背景设定分区清单与语义样式映射", () => {
    const headings = specById("backgroundSetting").sections.map((s) => s.heading)
    expect(headings).toEqual([
      "世界观背景",
      "世界前提与差异",
      "时代风貌",
      "社会结构",
      "文化习俗",
      "语言与称谓",
      "历史沿革",
      "核心设定规则",
      "信息公开度",
      "势力格局",
      "剧情作用",
      "写作约束",
    ])
    expect(profileSectionExtraClass("世界观背景")).toContain("lore")
    expect(profileSectionExtraClass("历史沿革")).toContain("lore")
    expect(profileSectionExtraClass("核心设定规则")).toContain("lore")
    expect(profileSectionExtraClass("社会结构")).toContain("lore")
  })

  it("地理设定分区清单与语义样式映射", () => {
    const headings = specById("geographySetting").sections.map((s) => s.heading)
    expect(headings).toEqual([
      "地理概览",
      "区域格局",
      "区域划分",
      "重要地点",
      "地形与气候环境",
      "资源与物产",
      "势力分布",
      "交通与通行",
      "危险区域与风险",
      "地域特色",
      "剧情作用",
      "写作约束",
    ])
    expect(profileSectionExtraClass("区域划分")).toContain("map")
    expect(profileSectionExtraClass("势力分布")).toContain("map")
    expect(profileSectionExtraClass("地形与气候环境")).toContain("map")
    // 危险区域同时命中区域网格与危险色矩阵
    expect(profileSectionExtraClass("危险区域与风险")).toContain("map")
    expect(profileSectionExtraClass("危险区域与风险")).toContain("matrix")
  })

  it("地点设定分区清单与语义样式映射", () => {
    const headings = specById("locationsOutline").sections.map((s) => s.heading)
    expect(headings).toEqual([
      "地点定位",
      "所属势力",
      "空间规则",
      "出入条件与限制",
      "资源与限制",
      "可触发事件",
      "常驻人物",
      "氛围与感官",
      "隐藏信息",
      "危险与禁忌",
      "剧情作用",
      "写作约束",
    ])
    expect(profileSectionExtraClass("地点定位")).toContain("place")
    expect(profileSectionExtraClass("空间规则")).toContain("place")
    expect(profileSectionExtraClass("可触发事件")).toContain("place")
    expect(profileSectionExtraClass("常驻人物")).toContain("roster")
    expect(profileSectionExtraClass("危险与禁忌")).toContain("matrix")
  })

  it("伏笔计划分区清单与语义样式映射", () => {
    const headings = specById("foreshadowingPlan").sections.map((s) => s.heading)
    expect(headings).toEqual([
      "伏笔总览",
      "埋设与回收节奏",
      "伏笔状态表",
      "线索链",
      "表层误导与真相",
      "回收日志",
      "过期与风险",
      "关联人物",
      "关联设定与主线",
      "悬念分级",
      "剧情作用",
      "写作约束",
    ])
    expect(profileSectionExtraClass("伏笔状态表")).toContain("threads")
    expect(profileSectionExtraClass("线索链")).toContain("threads")
    expect(profileSectionExtraClass("悬念分级")).toContain("threads")
    expect(profileSectionExtraClass("回收日志")).toContain("payoff")
    expect(profileSectionExtraClass("埋设与回收节奏")).toContain("payoff")
    expect(profileSectionExtraClass("过期与风险")).toContain("matrix")
  })

  it("各类渲染器能把 12 个分区全部渲染出来", () => {
    const cases: Array<[string, (doc: ProfileDocument) => string, string]> = [
      ["goldenFinger", renderGoldenFingerProfileHtml, "金手指 · 能力卡"],
      ["backgroundSetting", renderBackgroundProfileHtml, "背景设定 · 背景卡"],
      ["geographySetting", renderGeographyProfileHtml, "地理设定 · 地理卡"],
      ["locationsOutline", renderLocationProfileHtml, "地点设定 · 地点卡"],
      ["foreshadowingPlan", renderForeshadowingProfileHtml, "伏笔计划 · 伏笔台账"],
    ]
    for (const [id, render, eyebrow] of cases) {
      const spec = specById(id)
      const doc = docWithSections("测试对象", "类型", spec.sections.map((s) => s.heading))
      const html = render(doc)
      expect(html, `${id} 头部小标题`).toContain(eyebrow)
      for (const section of spec.sections) {
        expect(html, `${id} 缺少分区 ${section.heading}`).toContain(section.heading)
      }
      // 分区序号 1..12 都要出现
      expect(html).toContain(">12<")
    }
  })

  it("八类专属卡的参考样本 HTML 均已随仓库提供", () => {
    const samples = [
      "power-system/reference-sample.html",
      "power-system/golden-finger-reference.html",
      "world-rules/reference-sample.html",
      "map-progression/reference-sample.html",
      "map-progression/location-reference.html",
      "foreshadowing-suspense/reference-sample.html",
      "faction-system/reference-sample.html",
    ]
    for (const relative of samples) {
      const path = resolve(SKILLS_DIR, relative)
      expect(existsSync(path), `缺少参考样本 ${relative}`).toBe(true)
    }
    // 人物小传在 JueseSkill 目录
    expect(
      existsSync(resolve(SKILLS_DIR, "../JueseSkill/character-design/reference-sample.html")),
      "缺少参考样本 character-design/reference-sample.html",
    ).toBe(true)
  })

  it("profile 模板的芯片选择器必须提权为 .hero .chip（防止皮肤注入覆盖成白底白字）", () => {
    // 预览层会把皮肤 CSS 注入 iframe。档案卡（角色/势力/体系…）的芯片在深色头图上是白字，
    // 若被注入的 `.chip{background:var(--bg)}` 覆盖就变成「白底白字」。
    // 双保险：① 注入端不再包含 .chip（见 html-document-appearance.ts）；② 模板用 .hero .chip 提权。
    const templates = [
      "../JueseSkill/character-design/profile.html",
      "faction-system/profile.html",
      "power-system/profile.html",
      "power-system/golden-finger.html",
      "foreshadowing-suspense/profile.html",
      "map-progression/profile.html",
      "map-progression/location.html",
      "world-rules/background.html",
    ]
    for (const relative of templates) {
      const html = readFileSync(resolve(SKILLS_DIR, relative), "utf8")
      expect(html, `${relative} 缺少 .hero .chip 提权选择器`).toContain(".hero .chip{")
      // 不允许残留行首的未提权 .chip{ 规则（setting-cards 的 var(--bg) 芯片不在检查范围）
      expect(html, `${relative} 仍有未提权的 .chip{ 规则`).not.toMatch(/(^|\n)\.chip\{/)
    }
  })

  it("皮肤注入 CSS 不得包含 .chip 规则（否则历史 HTML 文档的头图芯片会白底白字）", () => {
    const injected = applyDocumentAppearance(
      "<!DOCTYPE html><html><head><title>x</title></head><body></body></html>",
      "jing",
    )
    expect(injected).not.toContain(".chip,")
    expect(injected).not.toMatch(/\.chip\{/)
  })
})

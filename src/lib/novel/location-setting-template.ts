/**
 * 地点设定专属「地点卡」HTML（类型薄封装，通用能力在 profile-document.ts）。
 *
 * - 结构化数据：AI 输出 ```json 围栏顶层 `locationProfileData`（多地点用 `locationProfiles` 数组）；
 * - 专属模板：`SheDingSkill/map-progression/location.html`
 *   （同心定位环头图 + **空间规则 / 可触发事件** 地点块表格）；
 * - 兜底：从 MD 正文解析。
 *
 * ⚠️ 地点设定与地理 / 金手指 / 力量体系 / 背景共用 fileType=`setting`，
 *    由调用方（attachSettingFamilyHtml）先判定子类型后再调用本模块。
 */

import templateHtml from "../../../skills/SkillHub/SheDingSkill/map-progression/location.html?raw"
import {
  createProfileTemplateRuntime,
  extractProfileDocuments,
  profileDocumentFromMarkdown,
  pickProfileDocument,
  renderProfileDocumentHtml,
  type ProfileDocument,
  type ProfileKvItem,
  type ProfileSection,
} from "./profile-document"

export type { ProfileKvItem, ProfileSection }
export type LocationProfileData = ProfileDocument

const JSON_KEYS = { single: "locationProfileData", list: "locationProfiles" }
const EYEBROW = "地点设定 · 地点卡"
const FALLBACK_NAME = "地点设定"

const runtime = createProfileTemplateRuntime({
  templateHtml,
  relativePaths: [
    "skills/SkillHub/SheDingSkill/map-progression/location.html",
    "_up_/skills/SkillHub/SheDingSkill/map-progression/location.html",
  ],
  projectOverride: ".qmai/地点设定模板.html",
})

export const LOCATION_PROFILE_TEMPLATE_READY = runtime.ready

export function getLocationProfileTemplate(): string {
  return runtime.getTemplate()
}

export function resetLocationProfileTemplateForTest(): void {
  runtime.resetForTest()
}

export async function primeLocationProfileTemplate(projectPath?: string | null): Promise<void> {
  await runtime.prime(projectPath)
}

/** 从 AI 原文解析地点卡（单个 locationProfileData 或数组 locationProfiles）。 */
export function extractLocationProfiles(text: string): LocationProfileData[] {
  return extractProfileDocuments(text, JSON_KEYS, FALLBACK_NAME)
}

/** 从 MD 正文解析地点卡（兜底）。 */
export function locationProfileFromMarkdown(md: string): LocationProfileData | null {
  return profileDocumentFromMarkdown(md, FALLBACK_NAME)
}

/** 用模板渲染地点卡 HTML。 */
export function renderLocationProfileHtml(
  doc: LocationProfileData,
  template: string = runtime.getTemplate(),
): string {
  return renderProfileDocumentHtml(doc, template, EYEBROW)
}

/** 从 MD 正文直接渲染地点卡。 */
export function renderLocationProfileForContent(content: string): string | null {
  const doc = locationProfileFromMarkdown(content)
  return doc ? renderLocationProfileHtml(doc) : null
}

/**
 * 给地点设定保存请求补 htmlContent。
 * 调用方需已确认这是「地点设定」（fileType=setting 且子类型匹配）；本函数不再自行判定子类型。
 * 已有真正的 HTML 文档时原样返回。
 */
export function attachLocationProfileHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
  },
>(request: T, sourceText: string): T {
  const existing = request.htmlContent?.trim() ?? ""
  if (/<html[\s>]/i.test(existing)) return request

  const docs = extractLocationProfiles(sourceText)
  const fromMd = locationProfileFromMarkdown(request.content)
  const doc = pickProfileDocument(docs, request) ?? fromMd
  if (!doc) return request
  return { ...request, htmlContent: renderLocationProfileHtml(doc) }
}

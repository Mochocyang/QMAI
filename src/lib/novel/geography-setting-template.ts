/**
 * 地理设定专属「地理卡」HTML（类型薄封装，通用能力在 profile-document.ts）。
 *
 * - 结构化数据：AI 输出 ```json 围栏顶层 `geographyProfileData`（多区域用 `geographyProfiles` 数组）；
 * - 专属模板：`SheDingSkill/map-progression/profile.html`
 *   （经纬网格感头图 + **区域划分 / 势力分布** 区域块表格）；
 * - 兜底：从 MD 正文解析。
 *
 * ⚠️ 地理设定与金手指 / 力量体系 / 背景 / 地点共用 fileType=`setting`，
 *    由调用方（attachSettingFamilyHtml）先判定子类型后再调用本模块。
 *    （地点设定可复用同一模板与渲染逻辑，仅 eyebrow 不同。）
 */

import templateHtml from "../../../skills/SkillHub/SheDingSkill/map-progression/profile.html?raw"
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
export type GeographyProfileData = ProfileDocument

const JSON_KEYS = { single: "geographyProfileData", list: "geographyProfiles" }
const EYEBROW = "地理设定 · 地理卡"
const FALLBACK_NAME = "地理设定"

const runtime = createProfileTemplateRuntime({
  templateHtml,
  relativePaths: [
    "skills/SkillHub/SheDingSkill/map-progression/profile.html",
    "_up_/skills/SkillHub/SheDingSkill/map-progression/profile.html",
  ],
  projectOverride: ".qmai/地理设定模板.html",
})

export const GEOGRAPHY_PROFILE_TEMPLATE_READY = runtime.ready

export function getGeographyProfileTemplate(): string {
  return runtime.getTemplate()
}

export function resetGeographyProfileTemplateForTest(): void {
  runtime.resetForTest()
}

export async function primeGeographyProfileTemplate(projectPath?: string | null): Promise<void> {
  await runtime.prime(projectPath)
}

/** 从 AI 原文解析地理卡（单个 geographyProfileData 或数组 geographyProfiles）。 */
export function extractGeographyProfiles(text: string): GeographyProfileData[] {
  return extractProfileDocuments(text, JSON_KEYS, FALLBACK_NAME)
}

/** 从 MD 正文解析地理卡（兜底）。 */
export function geographyProfileFromMarkdown(md: string): GeographyProfileData | null {
  return profileDocumentFromMarkdown(md, FALLBACK_NAME)
}

/** 用模板渲染地理卡 HTML。 */
export function renderGeographyProfileHtml(
  doc: GeographyProfileData,
  template: string = runtime.getTemplate(),
): string {
  return renderProfileDocumentHtml(doc, template, EYEBROW)
}

/** 从 MD 正文直接渲染地理卡。 */
export function renderGeographyProfileForContent(content: string): string | null {
  const doc = geographyProfileFromMarkdown(content)
  return doc ? renderGeographyProfileHtml(doc) : null
}

/**
 * 给地理设定保存请求补 htmlContent。
 * 调用方需已确认这是「地理设定」（fileType=setting 且子类型匹配）；本函数不再自行判定子类型。
 * 已有真正的 HTML 文档时原样返回。
 */
export function attachGeographyProfileHtml<
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

  const docs = extractGeographyProfiles(sourceText)
  const fromMd = geographyProfileFromMarkdown(request.content)
  const doc = pickProfileDocument(docs, request) ?? fromMd
  if (!doc) return request
  return { ...request, htmlContent: renderGeographyProfileHtml(doc) }
}

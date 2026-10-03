/**
 * 背景设定专属「背景卡」HTML（类型薄封装，通用能力在 profile-document.ts）。
 *
 * - 结构化数据：AI 输出 ```json 围栏顶层 `backgroundProfileData`（多设定用 `backgroundProfiles` 数组）；
 * - 专属模板：`SheDingSkill/world-rules/background.html`
 *   （典籍 / 年轮纹理头图 + **世界观 / 时代 / 文化 / 历史沿革** 分区，历史走时间线首列）；
 * - 兜底：从 MD 正文解析。
 *
 * ⚠️ 背景设定与地理 / 地点 / 金手指 / 力量体系共用 fileType=`setting`，
 *    由调用方（attachSettingFamilyHtml）先判定子类型后再调用本模块。
 */

import templateHtml from "../../../skills/SkillHub/SheDingSkill/world-rules/background.html?raw"
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
export type BackgroundProfileData = ProfileDocument

const JSON_KEYS = { single: "backgroundProfileData", list: "backgroundProfiles" }
const EYEBROW = "背景设定 · 背景卡"
const FALLBACK_NAME = "背景设定"

const runtime = createProfileTemplateRuntime({
  templateHtml,
  relativePaths: [
    "skills/SkillHub/SheDingSkill/world-rules/background.html",
    "_up_/skills/SkillHub/SheDingSkill/world-rules/background.html",
  ],
  projectOverride: ".qmai/背景设定模板.html",
})

export const BACKGROUND_PROFILE_TEMPLATE_READY = runtime.ready

export function getBackgroundProfileTemplate(): string {
  return runtime.getTemplate()
}

export function resetBackgroundProfileTemplateForTest(): void {
  runtime.resetForTest()
}

export async function primeBackgroundProfileTemplate(projectPath?: string | null): Promise<void> {
  await runtime.prime(projectPath)
}

/** 从 AI 原文解析背景卡（单个 backgroundProfileData 或数组 backgroundProfiles）。 */
export function extractBackgroundProfiles(text: string): BackgroundProfileData[] {
  return extractProfileDocuments(text, JSON_KEYS, FALLBACK_NAME)
}

/** 从 MD 正文解析背景卡（兜底）。 */
export function backgroundProfileFromMarkdown(md: string): BackgroundProfileData | null {
  return profileDocumentFromMarkdown(md, FALLBACK_NAME)
}

/** 用模板渲染背景卡 HTML。 */
export function renderBackgroundProfileHtml(
  doc: BackgroundProfileData,
  template: string = runtime.getTemplate(),
): string {
  return renderProfileDocumentHtml(doc, template, EYEBROW)
}

/** 从 MD 正文直接渲染背景卡。 */
export function renderBackgroundProfileForContent(content: string): string | null {
  const doc = backgroundProfileFromMarkdown(content)
  return doc ? renderBackgroundProfileHtml(doc) : null
}

/**
 * 给背景设定保存请求补 htmlContent。
 * 调用方需已确认这是「背景设定」（fileType=setting 且子类型匹配）；本函数不再自行判定子类型。
 * 已有真正的 HTML 文档时原样返回。
 */
export function attachBackgroundProfileHtml<
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

  const docs = extractBackgroundProfiles(sourceText)
  const fromMd = backgroundProfileFromMarkdown(request.content)
  const doc = pickProfileDocument(docs, request) ?? fromMd
  if (!doc) return request
  return { ...request, htmlContent: renderBackgroundProfileHtml(doc) }
}

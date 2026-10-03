/**
 * 伏笔计划专属「伏笔台账」HTML（类型薄封装，通用能力在 profile-document.ts）。
 *
 * - 结构化数据：AI 输出 ```json 围栏顶层 `foreshadowingProfileData`（多台账用 `foreshadowingProfiles` 数组）；
 * - 专属模板：`SheDingSkill/foreshadowing-suspense/profile.html`
 *   （线轴感头图 + **伏笔线**贯穿竖线 + **回收兑现**绿调 + 状态徽章）；
 * - 兜底：从 MD 正文解析（按 SETTING_PROFILE_STANDARD 的「伏笔追踪模板」分段）。
 */

import templateHtml from "../../../skills/SkillHub/SheDingSkill/foreshadowing-suspense/profile.html?raw"
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
export type ForeshadowingProfileData = ProfileDocument

const JSON_KEYS = { single: "foreshadowingProfileData", list: "foreshadowingProfiles" }
const EYEBROW = "伏笔计划 · 伏笔台账"
const FALLBACK_NAME = "伏笔计划"

const runtime = createProfileTemplateRuntime({
  templateHtml,
  relativePaths: [
    "skills/SkillHub/SheDingSkill/foreshadowing-suspense/profile.html",
    "_up_/skills/SkillHub/SheDingSkill/foreshadowing-suspense/profile.html",
  ],
  projectOverride: ".qmai/伏笔计划模板.html",
})

export const FORESHADOWING_PROFILE_TEMPLATE_READY = runtime.ready

export function getForeshadowingProfileTemplate(): string {
  return runtime.getTemplate()
}

export function resetForeshadowingProfileTemplateForTest(): void {
  runtime.resetForTest()
}

export async function primeForeshadowingProfileTemplate(projectPath?: string | null): Promise<void> {
  await runtime.prime(projectPath)
}

/** 从 AI 原文解析伏笔台账（单个 foreshadowingProfileData 或数组 foreshadowingProfiles）。 */
export function extractForeshadowingProfiles(text: string): ForeshadowingProfileData[] {
  return extractProfileDocuments(text, JSON_KEYS, FALLBACK_NAME)
}

/** 从 MD 正文解析伏笔台账（兜底）。 */
export function foreshadowingProfileFromMarkdown(md: string): ForeshadowingProfileData | null {
  return profileDocumentFromMarkdown(md, FALLBACK_NAME)
}

/** 用模板渲染伏笔台账 HTML。 */
export function renderForeshadowingProfileHtml(
  doc: ForeshadowingProfileData,
  template: string = runtime.getTemplate(),
): string {
  return renderProfileDocumentHtml(doc, template, EYEBROW)
}

/** 从 MD 正文直接渲染伏笔台账。 */
export function renderForeshadowingProfileForContent(content: string): string | null {
  const doc = foreshadowingProfileFromMarkdown(content)
  return doc ? renderForeshadowingProfileHtml(doc) : null
}

/**
 * 给伏笔计划保存请求补 htmlContent（fileType=foreshadowing，与其它类型不冲突）。
 * 已有真正的 HTML 文档时原样返回。
 */
export function attachForeshadowingProfileHtml<
  T extends {
    fileType: string
    htmlContent?: string
    content: string
    fileName?: string
    targetFolder?: string
  },
>(request: T, sourceText: string): T {
  // 子类型由调用方（attachOutlineHtml / attachSettingFamilyHtml）判定，本函数不再自查 fileType
  const existing = request.htmlContent?.trim() ?? ""
  if (/<html[\s>]/i.test(existing)) return request

  const docs = extractForeshadowingProfiles(sourceText)
  const fromMd = foreshadowingProfileFromMarkdown(request.content)
  const doc = pickProfileDocument(docs, request) ?? fromMd
  if (!doc) return request
  return { ...request, htmlContent: renderForeshadowingProfileHtml(doc) }
}

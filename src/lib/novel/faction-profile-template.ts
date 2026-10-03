/**
 * 组织势力专属「势力卡」HTML（类型薄封装，通用能力在 profile-document.ts）。
 *
 * - 结构化数据：AI 输出 ```json 围栏顶层 `factionProfileData`（多势力用 `factionProfiles` 数组）；
 * - 专属模板：`SheDingSkill/faction-system/profile.html`（印章式头图 + 分区卡片网格）；
 * - 兜底：从 MD 正文解析（按 SETTING_PROFILE_STANDARD 的「势力/组织模板」分段）。
 */

import templateHtml from "../../../skills/SkillHub/SheDingSkill/faction-system/profile.html?raw"
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
export type FactionProfileData = ProfileDocument

const JSON_KEYS = { single: "factionProfileData", list: "factionProfiles" }
const EYEBROW = "组织势力 · 势力卡"
const FALLBACK_NAME = "未命名势力"

const runtime = createProfileTemplateRuntime({
  templateHtml,
  relativePaths: [
    "skills/SkillHub/SheDingSkill/faction-system/profile.html",
    "_up_/skills/SkillHub/SheDingSkill/faction-system/profile.html",
  ],
  projectOverride: ".qmai/组织势力模板.html",
})

export const FACTION_PROFILE_TEMPLATE_READY = runtime.ready

export function getFactionProfileTemplate(): string {
  return runtime.getTemplate()
}

export function resetFactionProfileTemplateForTest(): void {
  runtime.resetForTest()
}

export async function primeFactionProfileTemplate(projectPath?: string | null): Promise<void> {
  await runtime.prime(projectPath)
}

/** 从 AI 原文解析势力卡（单个 factionProfileData 或数组 factionProfiles）。 */
export function extractFactionProfiles(text: string): FactionProfileData[] {
  return extractProfileDocuments(text, JSON_KEYS, FALLBACK_NAME)
}

/** 从 MD 正文解析势力卡（兜底）。 */
export function factionProfileFromMarkdown(md: string): FactionProfileData | null {
  return profileDocumentFromMarkdown(md, FALLBACK_NAME)
}

/** 用模板渲染势力卡 HTML。 */
export function renderFactionProfileHtml(
  doc: FactionProfileData,
  template: string = runtime.getTemplate(),
): string {
  return renderProfileDocumentHtml(doc, template, EYEBROW)
}

/** 从 MD 正文直接渲染势力卡。 */
export function renderFactionProfileForContent(content: string): string | null {
  const doc = factionProfileFromMarkdown(content)
  return doc ? renderFactionProfileHtml(doc) : null
}

/**
 * 给组织势力保存请求补 htmlContent：
 * 单势力 JSON 优先；多势力（per_item 拆多文件）改用该文件自己的 MD。
 * 已有真正的 HTML 文档时保留原 HTML。
 */
export function attachFactionProfileHtml<
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

  const profiles = extractFactionProfiles(sourceText)
  const fromMd = factionProfileFromMarkdown(request.content)
  const doc = pickProfileDocument(profiles, request) ?? fromMd
  if (!doc) return existing ? { ...request, htmlContent: undefined } : request
  return { ...request, htmlContent: renderFactionProfileHtml(doc) }
}

/**
 * 力量体系专属「体系卡」HTML（类型薄封装，通用能力在 profile-document.ts）。
 *
 * - 结构化数据：AI 输出 ```json 围栏顶层 `powerProfileData`（多体系用 `powerProfiles` 数组）；
 * - 专属模板：`SheDingSkill/power-system/profile.html`
 *   （能量感头图 + **等级阶梯** 加粗首列 / **代价矩阵** 危险色表头，由分区标题语义驱动）；
 * - 兜底：从 MD 正文解析。
 *
 * ⚠️ 力量体系与金手指 / 背景 / 地理 / 地点共用 fileType=`setting`，
 *    因此**由调用方（attachOutlineHtml）先判定子类型**，只有确实解析为「力量体系」时才调用本模块。
 */

import templateHtml from "../../../skills/SkillHub/SheDingSkill/power-system/profile.html?raw"
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
export type PowerProfileData = ProfileDocument

const JSON_KEYS = { single: "powerProfileData", list: "powerProfiles" }
const EYEBROW = "力量体系 · 体系卡"
const FALLBACK_NAME = "未命名体系"

const runtime = createProfileTemplateRuntime({
  templateHtml,
  relativePaths: [
    "skills/SkillHub/SheDingSkill/power-system/profile.html",
    "_up_/skills/SkillHub/SheDingSkill/power-system/profile.html",
  ],
  projectOverride: ".qmai/力量体系模板.html",
})

export const POWER_PROFILE_TEMPLATE_READY = runtime.ready

export function getPowerProfileTemplate(): string {
  return runtime.getTemplate()
}

export function resetPowerProfileTemplateForTest(): void {
  runtime.resetForTest()
}

export async function primePowerProfileTemplate(projectPath?: string | null): Promise<void> {
  await runtime.prime(projectPath)
}

/** 从 AI 原文解析体系卡（单个 powerProfileData 或数组 powerProfiles）。 */
export function extractPowerProfiles(text: string): PowerProfileData[] {
  return extractProfileDocuments(text, JSON_KEYS, FALLBACK_NAME)
}

/** 从 MD 正文解析体系卡（兜底）。 */
export function powerProfileFromMarkdown(md: string): PowerProfileData | null {
  return profileDocumentFromMarkdown(md, FALLBACK_NAME)
}

/** 用模板渲染体系卡 HTML。 */
export function renderPowerProfileHtml(
  doc: PowerProfileData,
  template: string = runtime.getTemplate(),
): string {
  return renderProfileDocumentHtml(doc, template, EYEBROW)
}

/** 从 MD 正文直接渲染体系卡。 */
export function renderPowerProfileForContent(content: string): string | null {
  const doc = powerProfileFromMarkdown(content)
  return doc ? renderPowerProfileHtml(doc) : null
}

/**
 * 给力量体系保存请求补 htmlContent。
 * 调用方需已确认这是「力量体系」（fileType 为 setting/outline 且子类型匹配）；
 * 本函数不再自行判定子类型，避免与 setting 模块循环依赖。
 * 已有真正的 HTML 文档时原样返回。
 */
export function attachPowerSystemHtml<
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

  const docs = extractPowerProfiles(sourceText)
  const fromMd = powerProfileFromMarkdown(request.content)
  const doc = pickProfileDocument(docs, request) ?? fromMd
  if (!doc) return request
  return { ...request, htmlContent: renderPowerProfileHtml(doc) }
}

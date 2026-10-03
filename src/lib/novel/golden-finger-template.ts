/**
 * 金手指专属「能力卡」HTML（类型薄封装，通用能力在 profile-document.ts）。
 *
 * - 结构化数据：AI 输出 ```json 围栏顶层 `goldenFingerProfileData`（多能力用 `goldenFingerProfiles` 数组）；
 * - 专属模板：`SheDingSkill/power-system/golden-finger.html`
 *   （系统启动感头图 + **已解锁能力** 系统面板等宽字体 + **边界与代价** 危险色）；
 * - 兜底：从 MD 正文解析（按 SETTING_PROFILE_STANDARD 的「金手指/能力体系模板」分段）。
 *
 * ⚠️ 金手指与力量体系 / 背景 / 地理 / 地点共用 fileType=`setting`，
 *    由调用方（attachSettingFamilyHtml）先判定子类型后再调用本模块。
 */

import templateHtml from "../../../skills/SkillHub/SheDingSkill/power-system/golden-finger.html?raw"
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
export type GoldenFingerProfileData = ProfileDocument

const JSON_KEYS = { single: "goldenFingerProfileData", list: "goldenFingerProfiles" }
const EYEBROW = "金手指 · 能力卡"
const FALLBACK_NAME = "未命名金手指"

const runtime = createProfileTemplateRuntime({
  templateHtml,
  relativePaths: [
    "skills/SkillHub/SheDingSkill/power-system/golden-finger.html",
    "_up_/skills/SkillHub/SheDingSkill/power-system/golden-finger.html",
  ],
  projectOverride: ".qmai/金手指模板.html",
})

export const GOLDEN_FINGER_PROFILE_TEMPLATE_READY = runtime.ready

export function getGoldenFingerProfileTemplate(): string {
  return runtime.getTemplate()
}

export function resetGoldenFingerProfileTemplateForTest(): void {
  runtime.resetForTest()
}

export async function primeGoldenFingerProfileTemplate(projectPath?: string | null): Promise<void> {
  await runtime.prime(projectPath)
}

/** 从 AI 原文解析能力卡（单个 goldenFingerProfileData 或数组 goldenFingerProfiles）。 */
export function extractGoldenFingerProfiles(text: string): GoldenFingerProfileData[] {
  return extractProfileDocuments(text, JSON_KEYS, FALLBACK_NAME)
}

/** 从 MD 正文解析能力卡（兜底）。 */
export function goldenFingerProfileFromMarkdown(md: string): GoldenFingerProfileData | null {
  return profileDocumentFromMarkdown(md, FALLBACK_NAME)
}

/** 用模板渲染能力卡 HTML。 */
export function renderGoldenFingerProfileHtml(
  doc: GoldenFingerProfileData,
  template: string = runtime.getTemplate(),
): string {
  return renderProfileDocumentHtml(doc, template, EYEBROW)
}

/** 从 MD 正文直接渲染能力卡。 */
export function renderGoldenFingerProfileForContent(content: string): string | null {
  const doc = goldenFingerProfileFromMarkdown(content)
  return doc ? renderGoldenFingerProfileHtml(doc) : null
}

/**
 * 给金手指保存请求补 htmlContent。
 * 调用方需已确认这是「金手指」（fileType=setting 且子类型匹配）；本函数不再自行判定子类型。
 * 已有真正的 HTML 文档时原样返回。
 */
export function attachGoldenFingerHtml<
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

  const docs = extractGoldenFingerProfiles(sourceText)
  const fromMd = goldenFingerProfileFromMarkdown(request.content)
  const doc = pickProfileDocument(docs, request) ?? fromMd
  if (!doc) return request
  return { ...request, htmlContent: renderGoldenFingerProfileHtml(doc) }
}

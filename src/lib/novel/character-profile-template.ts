/**
 * 人物小传专属「角色卡」HTML（类型薄封装，通用能力在 profile-document.ts）。
 *
 * - 结构化数据：AI 输出 ```json 围栏顶层 `characterProfileData`（多角色用 `characterProfiles` 数组）；
 * - 专属模板：`JueseSkill/character-design/profile.html`（渐变角色头图 + 分区卡片网格）；
 * - 兜底：从 MD 正文解析（覆盖「人物小传」多 Agent 只出 MD 的场景）。
 */

import templateHtml from "../../../skills/SkillHub/JueseSkill/character-design/profile.html?raw"
import {
  createProfileTemplateRuntime,
  extractProfileDocuments,
  pickProfileDocument,
  profileDocumentFromMarkdown,
  renderProfileDocumentHtml,
  type ProfileDocument,
  type ProfileKvItem,
  type ProfileSection,
} from "./profile-document"

export type { ProfileKvItem, ProfileSection }

export interface CharacterProfileData {
  name: string
  /** 男主 / 女主 / 反派 / 导师 … */
  roleType?: string
  /** 一句话定位 */
  tagline?: string
  sections: ProfileSection[]
}

const JSON_KEYS = { single: "characterProfileData", list: "characterProfiles" }
const EYEBROW = "人物小传 · 角色卡"
const FALLBACK_NAME = "未命名角色"

const runtime = createProfileTemplateRuntime({
  templateHtml,
  relativePaths: [
    "skills/SkillHub/JueseSkill/character-design/profile.html",
    "_up_/skills/SkillHub/JueseSkill/character-design/profile.html",
  ],
  projectOverride: ".qmai/人物小传模板.html",
})

function toCharacter(doc: ProfileDocument): CharacterProfileData {
  return {
    name: doc.name,
    ...(doc.tag ? { roleType: doc.tag } : {}),
    ...(doc.tagline ? { tagline: doc.tagline } : {}),
    sections: doc.sections,
  }
}

function toDoc(data: CharacterProfileData): ProfileDocument {
  return {
    name: data.name,
    ...(data.roleType ? { tag: data.roleType } : {}),
    ...(data.tagline ? { tagline: data.tagline } : {}),
    sections: data.sections,
  }
}

export const CHARACTER_PROFILE_TEMPLATE_READY = runtime.ready

export function getCharacterProfileTemplate(): string {
  return runtime.getTemplate()
}

export function resetCharacterProfileTemplateForTest(): void {
  runtime.resetForTest()
}

export async function primeCharacterProfileTemplate(projectPath?: string | null): Promise<void> {
  await runtime.prime(projectPath)
}

/** 从 AI 原文解析角色卡（单个 characterProfileData 或数组 characterProfiles）。 */
export function extractCharacterProfiles(text: string): CharacterProfileData[] {
  return extractProfileDocuments(text, JSON_KEYS, FALLBACK_NAME).map(toCharacter)
}

/** 从 MD 正文解析角色卡（兜底）。 */
export function characterProfileDataFromMarkdown(md: string): CharacterProfileData | null {
  const doc = profileDocumentFromMarkdown(md, FALLBACK_NAME)
  return doc ? toCharacter(doc) : null
}

/** 用模板渲染角色卡 HTML。 */
export function renderCharacterProfileHtml(
  data: CharacterProfileData,
  template: string = runtime.getTemplate(),
): string {
  return renderProfileDocumentHtml(toDoc(data), template, EYEBROW)
}

/** 从 MD 正文直接渲染角色卡。 */
export function renderCharacterProfileForContent(content: string): string | null {
  const data = characterProfileDataFromMarkdown(content)
  return data ? renderCharacterProfileHtml(data) : null
}

/**
 * 为单个角色草稿生成角色卡 HTML：
 * 优先按名字匹配 AI 原文里的 characterProfiles / characterProfileData，匹配不到回退该草稿 MD。
 */
export function buildCharacterProfileHtmlForDraft(input: {
  name: string
  content: string
  /** 目标文件名（如「角色-男主-林辰.md」），用于批量时按名字挑选本份档案 */
  fileName?: string
  sourceText?: string
  /** 已解析好的 profile 列表（批量场景一次解析、多次复用） */
  profiles?: CharacterProfileData[]
}): string | null {
  const profiles = input.profiles ?? extractCharacterProfiles(input.sourceText ?? "")
  // 与其他 7 类保持一致：走统一的「按名字挑选」而不是严格相等 ——
  // 批量生成时 JSON 里的名字常带括号/前缀（如「林辰（男主）」），严格相等会匹配失败而回退 MD。
  const matched = pickProfileDocument(profiles, {
    fileName: input.fileName ?? input.name,
    content: input.content,
    targetFolder: "人物小传",
  })
  if (matched) return renderCharacterProfileHtml(matched)
  return renderCharacterProfileForContent(input.content)
}

/**
 * 给人物小传保存请求补 htmlContent：
 * 单角色 JSON 优先；多角色（per_item 拆多文件）改用该文件自己的 MD。
 * 已有真正的 HTML 文档时保留原 HTML。
 */
export function attachCharacterProfileHtml<
  T extends { fileType: string; htmlContent?: string; content: string },
>(request: T, sourceText: string): T {
  // 子类型由调用方（attachOutlineHtml / attachSettingFamilyHtml）判定，本函数不再自查 fileType
  const existing = request.htmlContent?.trim() ?? ""
  if (/<html[\s>]/i.test(existing)) return request

  const profiles = extractCharacterProfiles(sourceText)
  const fromMd = characterProfileDataFromMarkdown(request.content)
  const data = profiles.length === 1 ? profiles[0] : fromMd
  if (!data) return existing ? { ...request, htmlContent: undefined } : request
  return { ...request, htmlContent: renderCharacterProfileHtml(data) }
}

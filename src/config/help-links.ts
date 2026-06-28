/**
 * 帮助链接集中配置
 *
 * 用途：所有面板"标题 + 问号"的帮助超链接统一在这里管理。
 * 添加新链接：在 HELP_LINKS 里加一行即可。
 */
export const HELP_LINKS = {
  bookAnalysis:
    "https://tcnk9ik08e1c.feishu.cn/wiki/X50GwYD1QisSF1kXPxCcdej1nth",
  outline: "https://tcnk9ik08e1c.feishu.cn/wiki/BFtzwwFp8iJNryk7QkrcZNcBnnc",
  memory: "https://tcnk9ik08e1c.feishu.cn/wiki/UQCTw0EJSiCBVTknapCcUnEln6g",
  soul: "https://tcnk9ik08e1c.feishu.cn/wiki/QRPwwsXZAi6I4wksRpFca775n6d",
  settings: "https://tcnk9ik08e1c.feishu.cn/wiki/Z4cjwp0U4iqZ5TkhRiIckmy6nRb",
  review: "https://tcnk9ik08e1c.feishu.cn/wiki/J6zCwjcWDiMAdkkOrjgcHtPjngh",
  graph: "https://tcnk9ik08e1c.feishu.cn/wiki/WlOpwrEQYiqczGkSohtcy3U0n7g",
  chapter: "https://tcnk9ik08e1c.feishu.cn/wiki/TUcKwxtqbihdYvk7bivcaaqGnfd",
  storySimulation:
    "https://tcnk9ik08e1c.feishu.cn/wiki/Za7hwMcM4iDy78kixapcOUrwnGb",
} as const

export type HelpLinkKey = keyof typeof HELP_LINKS

/**
 * 取帮助链接 URL。找不到时返回 null，调用方应当降级为不显示链接。
 */
export function getHelpLinkUrl(key: HelpLinkKey): string | null {
  return HELP_LINKS[key] ?? null
}

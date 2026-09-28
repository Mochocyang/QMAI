// UI 界面版本：已统一为只保留新版界面，恒为最新版。
export const IS_UI_TEST_BUILD = true

/** UI 测试版用于本机偏好存储的键前缀（仅在测试版内使用，不写入正式配置）。 */
export const UI_TEST_STORAGE_PREFIX = "qm-uitest-"

export type UiTestSkin = "jing" | "zhi" | "xing"

export const UI_TEST_SKIN_KEY = `${UI_TEST_STORAGE_PREFIX}skin`

export const UI_TEST_SKINS: Array<{
  id: UiTestSkin
  name: string
  hint: string
}> = [
  { id: "jing", name: "静水", hint: "浅鼠尾草绿 · 留白开阔" },
  { id: "zhi", name: "纸间", hint: "暖纸底色 · 界面退后" },
  { id: "xing", name: "星夜", hint: "低对比夜间 · 看见故事" },
]

export function readUiTestSkin(): UiTestSkin {
  if (typeof localStorage === "undefined") return "jing"
  const value = localStorage.getItem(UI_TEST_SKIN_KEY)
  if (value === "zhi" || value === "xing" || value === "jing") return value
  return "jing"
}

export function writeUiTestSkin(skin: UiTestSkin): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(UI_TEST_SKIN_KEY, skin)
}
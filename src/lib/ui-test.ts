// UI 测试版开关。
// 优先使用本机持久化偏好（可通过设置页切换）；打包时传入 VITE_QMAI_UI_TEST=1 仅作为强制开启的兜底。
// 切换后需要重启软件，运行时按启动时的值渲染界面。
const UI_TEST_MODE_KEY = "qmai-ui-test-mode"
const FORCE_UI_TEST_BUILD = import.meta.env.VITE_QMAI_UI_TEST === "1"

function readUiTestMode(): boolean | null {
  if (typeof localStorage === "undefined") return null
  try {
    const value = localStorage.getItem(UI_TEST_MODE_KEY)
    if (value === "1") return true
    if (value === "0") return false
    return null
  } catch {
    return null
  }
}

const STORED_UI_TEST_MODE = readUiTestMode()
export const IS_UI_TEST_BUILD = STORED_UI_TEST_MODE ?? FORCE_UI_TEST_BUILD

/** 写入本机界面版本偏好：true=新版界面，false=旧版界面。 */
export function setUiTestMode(enabled: boolean): void {
  if (typeof localStorage === "undefined") {
    throw new Error("当前环境不支持保存本机界面偏好")
  }
  localStorage.setItem(UI_TEST_MODE_KEY, enabled ? "1" : "0")
}

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
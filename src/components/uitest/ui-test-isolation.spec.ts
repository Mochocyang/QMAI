import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "vitest"
const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8")
it("只保留新版 UI：不再引用旧版外壳与界面分支开关", () => {
  expect(app).not.toContain("AppLayout")
  expect(app).not.toContain("WelcomeScreen")
  expect(app).not.toContain("IS_UI_TEST_BUILD")
})
it("恒以新版外壳 UiTestShell 渲染", () => {
  expect(app).toContain("UiTestShell")
})

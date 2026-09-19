import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "vitest"
const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8")
it("测试版不加载旧直角风格的important覆盖，正式版保留原偏好", () => {
  expect(app).toContain('applyVisualStyle(IS_UI_TEST_BUILD ? "classic" : visualStyle)')
  expect(app).toContain('applyVisualStyle(IS_UI_TEST_BUILD ? "classic" : visualStyleToUse)')
})
it("测试版仍受构建开关保护，更新检查与统计不启用", () => {
  expect(app).toContain('if (IS_UI_TEST_BUILD)')
  expect(app).toContain('if (!IS_UI_TEST_BUILD)')
  expect(app).toContain('<AppLayout onSwitchProject={handleSwitchProject} />')
})

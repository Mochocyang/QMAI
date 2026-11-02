import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 备份提示条的位置守卫（用户 2026-11-02 指定：放在「我的模型设置」标题行右侧）。
 *
 * 之前它单独占一行、挂在标题下方，用户嫌太占地方，要求内联到标题那一行的右侧。
 * 这里用源码结构断言（和 settings-view.model-sync 守卫同思路）：只看
 * <ModelArchiveNotice /> 是否落在 model-library-heading 这个 flex 容器内部、
 * 且在「N 个配置」之前（配合 CSS 的 margin-left:auto 推到右侧）。
 *
 * 为什么用文本断言而不是渲染 LlmProviderSection：该组件依赖 wiki-store、
 * 插件同步、i18n 等一整套环境，为一个"位置"渲染它代价过大且脆；而位置是
 * 结构性事实，源码里对不对一眼可判，文本守卫足够。
 */

const view = readFileSync(
  resolve(process.cwd(), "src/components/settings/sections/llm-provider-section.tsx"),
  "utf8",
)

describe("备份提示条在「我的模型设置」标题行右侧", () => {
  const heading = view.match(/<div className="model-library-heading">[\s\S]*?<\/div>/)

  it("ModelArchiveNotice 渲染在标题行容器内部（不是下方独占一行）", () => {
    expect(heading, "标题行容器未找到").not.toBeNull()
    expect(heading![0]).toContain("<ModelArchiveNotice />")
  })

  it("提示条排在「N 个配置」之前（右侧区域，由 margin-left:auto 推右）", () => {
    const inner = heading![0]
    expect(inner.indexOf("<ModelArchiveNotice />")).toBeLessThan(inner.indexOf("个配置"))
  })
})

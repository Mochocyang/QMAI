/**
 * `plugins_set_project` 的**接线守卫**（源码文本断言）。
 *
 * 为什么除了行为单测还要这一条：`syncPluginsProject` 再正确，只要某个打开入口
 * 忘了走它，`/host/project/*` 在那条路径上就是全线失灵 —— 而那种失灵没有任何
 * 报错，只有用户发现"插件按钮点了没反应"。本仓既有同类守卫
 * （`analytics-wiring.test.ts` / `app-updater-wiring.test.ts`）就是为这种
 * "功能写好了却没人调用"的失联准备的。
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = resolve(__dirname, "../../..")
const read = (relative: string) => readFileSync(resolve(ROOT, relative), "utf8")

describe("项目生命周期的插件宿主同步", () => {
  const app = read("src/App.tsx")

  it("三个打开入口都走 openProjectWithPluginSync（打开成功才通知）", () => {
    // 启动恢复 / 切换最近项目 / 打开已有项目
    expect(app.match(/openProjectWithPluginSync\(\(\) => openProject\(/g) ?? []).toHaveLength(3)
    // 不允许再有裸 `await openProject(` 绕过同步（否则那条路径上插件拿不到根目录）
    expect(app).not.toContain("await openProject(")
  })

  it("关闭项目传 null（不传就会继续往一本已经关掉的书里写）", () => {
    expect(app).toContain("void syncPluginsProject(null)")
    // 必须在 handleSwitchProject 里：切回书架 = 没有当前项目
    const switchProject = app.slice(app.indexOf("async function handleSwitchProject"))
    expect(switchProject.slice(0, 800)).toContain("void syncPluginsProject(null)")
  })

  it("新建项目与书架打开这两条路径也各自通知一次", () => {
    expect(read("src/commands/fs.ts")).toContain("await syncPluginsProject(raw.path)")
    expect(read("src/lib/mcp/bookshelf.ts")).toContain("await syncPluginsProject(opened.path)")
  })
})

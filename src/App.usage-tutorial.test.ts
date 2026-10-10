import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 丙-4c：分步引导教程「首次进入对话自动弹一次」的**判据落点**。
 *
 * ── 为什么只能做源码文本断言 ──
 * `handleProjectOpened` 是 `App.tsx` 里的函数，挂载整个 App 去驱动它需要一个
 * 比本文件大得多的夹具（Tauri store / 项目目录 / 后续 hydration）。
 * 仓库对 `App.tsx` 的既有守卫（`App.search-mode.test.tsx`、
 * `ui-test-isolation.spec.ts`）用的也是源码文本断言，这里照同一风格。
 *
 * 但这条断言**不是**「字符串在文件里」那种弱断言：它钉的是**两个顺序性质**，
 * 而那正是本条需求最容易被实现错的地方（下面注释里有具体后果）。
 */
const app = readFileSync(resolve(__dirname, "App.tsx"), "utf8")

describe("App.tsx：教程的一次性请求标记", () => {
  it("用刚 await 到的这本书自己的配置决定，而不是 store 里可能还残着上一本书的值", () => {
    const loadIndex = app.indexOf("await loadNovelConfig(proj.id, proj.path)")
    const requestIndex = app.indexOf("setUsageTutorialRequested(")
    expect(loadIndex, "handleProjectOpened 必须仍然 await loadNovelConfig").toBeGreaterThan(-1)
    expect(requestIndex, "必须在 App 里置教程的一次性请求标记").toBeGreaterThan(-1)
    /*
     * ⚠️ 顺序是承重的，不是风格问题：
     * `resetProjectState()` **完全不碰** `novelConfig`（lib/reset-project-state.ts 里
     * 没有任何 novelConfig 引用），而 `setProject` → `await loadNovelConfig` →
     * `setNovelConfig` 之间存在一个窗口，此间 store 里还是**上一本书**的值。
     * 在这个窗口里读 store 的 `usageTutorialSeen` 会把新书误判成「已经看过」。
     */
    expect(
      requestIndex,
      "置标记必须发生在 await loadNovelConfig 之后，否则读到的是上一本书的配置",
    ).toBeGreaterThan(loadIndex)
    expect(
      app.slice(requestIndex, requestIndex + 120),
      "标记的取值必须来自刚加载到的那本书的配置",
    ).toContain("projectNovelConfig")
    /*
     * 判据本身（`!usageTutorialSeen`）抽在 `src/lib/usage-tutorial.ts` 里按真值表
     * 单测（`usage-tutorial.spec.ts`）。这里只需要守住「App 真的用了那个判据」——
     * 否则判据被单测覆盖得很漂亮、却根本没人调用。
     */
    expect(
      app.slice(requestIndex, requestIndex + 120),
      "判据必须走 shouldRequestUsageTutorial，不要在 App 里另写一份",
    ).toContain("shouldRequestUsageTutorial")
    expect(app).toContain('from "@/lib/usage-tutorial"')
  })

  it("不改动三条反向守卫盯着的字符串", () => {
    // ui-test-isolation.spec.ts:6-9 对 App.tsx 断言这三个字符串**不存在**；
    // 丙-4c 要改 App.tsx，所以顺手在这里再钉一次，免得误引入。
    expect(app).not.toContain("AppLayout")
    expect(app).not.toContain("WelcomeScreen")
    expect(app).not.toContain("IS_UI_TEST_BUILD")
  })
})

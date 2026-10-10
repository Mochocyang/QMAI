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
    /*
     * ── F2（修复批）：`isCurrentProject(proj)` 必须真的被传进去 ──
     *
     * 评审实测：这一段原来只有一个 `&& isCurrentProject(proj)`，**删掉它
     * 全套测试仍然全绿**（真值表只覆盖 `usageTutorialSeen` 那一维，
     * 而挂载整个 App 去驱动 `handleProjectOpened` 的成本高到没人会写）。
     *
     * 修法分两处，**两处都要**、缺一不可：
     *   ① 判据那一维搬进 `shouldRequestUsageTutorial`，由
     *      `usage-tutorial.spec.ts` 的真值表钉住（删掉 `!isCurrentProject` 会红）；
     *   ② 调用点必须真的把项目身份传进去 —— 否则判据支持了、却没人用
     *      （把第二个实参写死成 `true` 就是这种：真值表全绿，行为却没了）。
     *      这一条源码断言钉的就是 ②。
     *
     * 断言用 `requestIndex` 起切片、取到足够长度覆盖整个调用点，
     * 并同时要求出现 `shouldRequestUsageTutorial` 与 `isCurrentProject(proj)`：
     * 少任何一个都会红。
     */
    /*
     * 断言用一条**精确到实参**的正则，而不是「取后面 N 个字符看有没有这个词」：
     * 后者会被紧随其后的另一句 `if (isCurrentProject(proj))`（`loadRevisionFeedbackWindowConfig`
     * 那一处）意外满足 —— 那是同一个文件里真实存在的第二处调用，切片取长一点
     * 就会把「调用点写死了 true」放过。这正是本仓库反复记录的
     * 「判据的形状必须对准它要说的那件事」。
     */
    expect(
      app,
      "调用点必须把项目身份一起传进判据（第二个实参写死 true 就等于删掉了那个守卫）",
    ).toMatch(
      /setUsageTutorialRequested\(\s*shouldRequestUsageTutorial\(\s*projectNovelConfig\s*,\s*isCurrentProject\(proj\)\s*\)\s*,?\s*\)/,
    )
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

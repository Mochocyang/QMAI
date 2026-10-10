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
    /*
     * 两条 120 字切片：**各自只管一个词**，不要把它们的命题说大。
     * ① 取值来自「刚 await 到的那本书的配置」；② 判据走 lib 里的那一份，不在 App 里另写。
     * ⚠️ 切片里**没有** `isCurrentProject(proj)` 这一项 —— 它由下面那条精确正则钉住。
     * （修复批 2 订正：这里原来有一段说明写成「切片同时要求出现
     * `shouldRequestUsageTutorial` 与 `isCurrentProject(proj)`」，与代码不符。）
     */
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
     *      下面这条源码断言钉的就是 ②。
     *
     * 判据用**精确到实参**的正则，而不是「取后面 N 个字符看有没有这个词」。
     *
     * ⚠️ 修复批 2 实测的距离（`App.tsx` 里以 `setUsageTutorialRequested(` 为 0 点）：
     *   · 调用点里那个**应当**被要到的 `isCurrentProject(proj)` 在 **delta 81**；
     *   · 同一文件里真实存在的第二处 `if (isCurrentProject(proj))`
     *     （`loadRevisionFeedbackWindowConfig` 那一句）在 **delta 226**。
     * 所以这里曾经写的「紧随其后」是**不准确**的：226 已经超出 120 字切片，
     * 一个 120 字的窗口**不会**被它骗到（那两条切片今天因此仍然成立）。
     * 会骗到切片的是「把窗口取得足够长、覆盖到 226 字」那种写法 ——
     * 正则法不依赖窗口长度，所以它既不会漏掉，也不会被那处第二处调用满足。
     * 这正是本仓库反复记录的「判据的形状必须对准它要说的那件事」。
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

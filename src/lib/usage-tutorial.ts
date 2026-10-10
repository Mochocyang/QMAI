/**
 * 「这次要不要自动弹分步引导教程」的判据（丙-4c）。
 *
 * ── 为什么要单独抽出来 ──
 * 这个判据写在 `App.tsx` 的 `handleProjectOpened` 里，而那个函数挂载整个 App
 * 才能驱动（Tauri store / 项目目录 / 后续 hydration），成本高到没人会写。
 * 现实结果就是：判据只剩「源码里有这个词」这种弱断言 —— 把
 * `!config.usageTutorialSeen` 整段删掉、改成永远弹或永远不弹，都照样绿。
 *
 * 抽成纯函数之后，判据本身可以按真值表逐一钉住；`App.tsx` 里只剩
 * 「在正确的时机、用正确的那份 config 调它」这一件事（那条用源码顺序断言守）。
 *
 * ⚠️ 判据的输入必须是**刚 `await loadNovelConfig` 拿到的那本书自己的 config**。
 * 原因：`resetProjectState()`（lib/reset-project-state.ts）**完全不碰**
 * `novelConfig`，而 `setProject` → `await loadNovelConfig` → `setNovelConfig`
 * 之间存在一个窗口，此间 store 里还是**上一本书**的值。在这个窗口里读 store
 * 会把新书误判成「已经看过教程」。
 */
export interface UsageTutorialDecisionInput {
  /** `novelConfig.usageTutorialSeen`：这本书的教程自动弹过没有。 */
  usageTutorialSeen?: boolean
}

/**
 * 只有「这本书还没自动弹过」才请求弹一次。
 *
 * `null`（读取失败拿不到配置）时返回 `false`：宁可这次不弹，也不要在一本
 * 状态不明的书上弹 —— 弹错会顺手把 `usageTutorialSeen` 记成 true，
 * 用户以后再也不自动看到教程了。
 *
 * 默认值方向也是承重的：`DEFAULT_NOVEL_CONFIG.usageTutorialSeen` 必须是 `false`，
 * 否则新书永远不会自动弹（`project-store` 里对应的 `?? DEFAULT` 一并守着这点）。
 */
export function shouldRequestUsageTutorial(config: UsageTutorialDecisionInput | null | undefined): boolean {
  if (!config) return false
  return !config.usageTutorialSeen
}

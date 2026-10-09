/**
 * 关窗口前的「最后一次落盘」注册表。
 *
 * ── 为什么需要它（一个真实的设置丢失路径）──
 *
 * 最终整体代码审查查出的缺陷，链路如下：
 *
 *   1. 用户在写作现场拖动「行间距」滑块 → `applyBodyTypographyChange`
 *      同步写 zustand / localStorage，然后排一个 **400ms 的组件级去抖**
 *      （`preview-panel.tsx` 的 `bodyTypographyPersist`）。
 *   2. 用户在 400ms 内关窗口（或 Alt+F4）。
 *   3. `App.tsx` 的 `onCloseRequested` → `flushAppState()`。
 *      但 `flushAppState()` 只 flush **app-state 那一层的** store，
 *      而正文排版的任务此刻**还没被排出去**（去抖没到点，`saveUiBody*` 一次都没调），
 *      所以它没有任何东西可以 flush。
 *   4. 紧接着 `getCurrentWindow().destroy()`。webview 被销毁，
 *      **React 不会走 unmount 生命周期** ——
 *      `preview-panel.tsx` 卸载 effect 里那个 `persist.flush()` 根本没机会执行。
 *   5. 下次启动时读回是 **app-state 优先**的（`App.tsx`），
 *      于是用户看到「我明明调过，重开又变回去了」—— 正是这套去抖本来要防的事。
 *
 * 关浮层那条路径是安全的（document 的 mousedown 先触发 closeBodyFontPopover，
 * 里面就是 flush），所以缺陷只在"不经过 mousedown 的关闭"上暴露 ——
 * 也就是用户最自然的操作：调完直接关窗口。
 *
 * ── 为什么用注册表，而不是让 App 直接 import 那个 persist ──
 *
 * App 不应该知道"正文排版"这个具体模块，更不该知道它内部用的是哪种去抖。
 * 其它模块（将来还有别的组件级去抖）同理。注册表把"关窗前要做什么"
 * 变成各模块自己声明的一件事，App 只负责按顺序执行。
 *
 * ── 与 `flush()` / `flushAsync()` 的关系 ──
 *
 * 注册进来的函数**应当**返回 Promise 并且真的等到写完 ——
 * 因为 `runPreCloseFlushes()` 之后立刻就是 `window.destroy()`，
 * 没写完的异步写盘会被切断。正文排版这里用的是
 * `DebouncedPersist.flushAsync()`（不是 `flush()`，后者是 `void task()`
 * 只启动不等待）。
 *
 * 用法：
 *   useEffect(() => {
 *     const unregister = registerPreCloseFlush(() => persist.flushAsync())
 *     return () => { unregister(); void persist.flushAsync() }
 *   }, [])
 */

/** 关窗前要执行的落盘动作。返回 Promise 才能真正等到写完。 */
export type PreCloseFlush = () => void | Promise<void>

const registry = new Set<PreCloseFlush>()

/**
 * 注册一个关窗前要执行的落盘动作，返回**注销函数**。
 * 组件卸载时必须调用注销函数，否则已卸载组件的旧闭包会一直留在表里，
 * 关窗时执行到它只是浪费（不会报错），但它引用着已被丢弃的 ref。
 */
export function registerPreCloseFlush(fn: PreCloseFlush): () => void {
  registry.add(fn)
  return () => { registry.delete(fn) }
}

/** 当前注册数量（诊断与测试用；App 不依赖它）。 */
export function preCloseFlushCount(): number {
  return registry.size
}

/**
 * 依次执行全部已注册的落盘动作，**每个都 await**。
 *
 * 语义选择：
 *   · **不并发**，按注册顺序串行 —— 关窗路径上并发写同一份 app-state.json
 *     没有好处，串行还让"谁先落盘"可预期。
 *   · **一个失败不阻断其它**：某个模块写盘失败，不该让另一个模块的设置也丢。
 *     失败的记进返回值并打日志，由调用方决定要不要提示用户。
 *   · 先取快照再遍历：动作执行期间有人注册/注销也不会让遍历错乱。
 */
export async function runPreCloseFlushes(): Promise<{ ran: number; failed: number }> {
  const snapshot = [...registry]
  let failed = 0
  for (const fn of snapshot) {
    try {
      await fn()
    } catch (error) {
      failed++
      console.error("关窗前落盘失败（已继续执行其它落盘）:", error)
    }
  }
  return { ran: snapshot.length - failed, failed }
}

/** 仅供测试：清空注册表，避免用例之间互相影响。 */
export function __resetPreCloseFlushesForTest(): void {
  registry.clear()
}

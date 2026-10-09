/**
 * 把「连续发生的保存请求」合并成一次落盘。
 *
 * ── 为什么需要它 ──
 * 写作现场浮层里的滑块在拖动中会为每一格触发 onChange。若每次都
 * `await save(...)`，一次拖动会写几十遍 app-state.json。
 * 注意**立即生效**的部分（zustand store + CSS 变量）不受影响，
 * 被合并的只是落盘这一个动作 —— 用户看到的反馈依然是即时的。
 *
 * ── 为什么要 flush ──
 * 「拖完最后一下就关掉浮层」是最常见的操作顺序。若只靠定时器，
 * 关浮层时最后一次改动会被丢掉。关闭时必须 flush。
 */
export interface DebouncedPersist {
  /**
   * 登记一次待落盘动作，**覆盖**之前尚未执行的那一次 —— 是「替换」，
   * 不是「排队」。对同一根滑块的连续拖动正是想要的；
   * 但**不要给每个字段各排一个动作**：用户若在去抖窗口内先后动了两个
   * 控件，前一个的落盘会被后一个顶掉。正确用法见任务 11 的
   * persistAllBodyTypography（排一个「写全套值」的动作）。
   */
  schedule(run: () => Promise<void>): void
  /** 立刻执行待落盘动作（若有），并取消定时器。 */
  flush(): void
  /**
   * 同 `flush()`，但**等那次落盘真正写完**才 resolve。
   *
   * ── 为什么必须有这个异步版本 ──
   * `flush()` 内部是 `void task()`：它只保证动作**被启动**，不保证写完。
   * 对"关浮层"这类场景够了（进程还在，写盘会自己跑完），
   * 但对**关窗口**不够 —— 紧随其后的是 `window.destroy()`，
   * webview 一销毁，那次还没写完的异步落盘就被切断，
   * 结果依然是"用户调了、下次开又变回去"。
   *
   * 所以关窗流程必须 `await flushAsync()`；两者并存而不是把 flush 改成异步，
   * 是为了不动既有的一堆同步调用点。
   *
   * ── ⚠ 失败语义：写盘抛错时，这次改动就被**丢弃**，不会重试 ──
   *
   * 实现是先 `pending = null` 再 `await task()`，所以任务抛错时那次改动
   * 既不在 `pending` 里、也不会重新排队 —— 异常会向调用方抛出，
   * 但值本身不再保留。`flush()` / `runPending()` 同病（它们连抛都不抛，`void task()`）。
   *
   * 这是**有意的取舍**，不是疏漏：重试需要"什么算可重试"的策略与退避，
   * 而这里的任务都是往 app-state.json 写一份完整快照 ——
   * 下一次任何字段的改动都会带上全套值重写一遍，等价于自动重试。
   * 真正需要知道的是"这次没写成"，那由调用方看到抛错来处理
   * （关窗路径见 App.tsx 对 `failed` 的显式处理）。
   */
  flushAsync(): Promise<void>
  /**
   * 丢弃待落盘动作，不再触发。
   *
   * ⛔ **不要在组件卸载时用它** —— 那会丢掉最后一次改动。
   *
   * 这条注释原来写的是「组件卸载时用」，而它正是 I1 那个真缺陷的成因：
   * preview-panel 在卸载时调了 dispose()，于是「拖完滑块 400ms 内
   * 关窗 / 键盘导航离开」这条路径上，用户最后一次调整**永远不会落盘**
   * （去抖窗口还没到，pending 就被置空丢了）。
   * 卸载路径要的是 flush()：它会立刻把 pending 执行掉。
   * 见 preview-panel.tsx 卸载 effect 上的那段注释与对应单测。
   *
   * 适用场景：确认"这份待落盘数据已经不需要了"（例如整份状态被重置）。
   */
  dispose(): void
}

export function createDebouncedPersist(delayMs = 400): DebouncedPersist {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: (() => Promise<void>) | null = null

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function runPending() {
    const task = pending
    pending = null
    if (task) void task()
  }

  return {
    schedule(run) {
      pending = run
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        runPending()
      }, delayMs)
    },
    flush() {
      clearTimer()
      runPending()
    },
    async flushAsync() {
      clearTimer()
      const task = pending
      pending = null
      if (task) await task()
    },
    dispose() {
      clearTimer()
      pending = null
    },
  }
}

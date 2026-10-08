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
  /** 丢弃待落盘动作，不再触发（组件卸载时用）。 */
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
    dispose() {
      clearTimer()
      pending = null
    },
  }
}

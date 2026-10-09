// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  registerPreCloseFlush,
  runPreCloseFlushes,
  preCloseFlushCount,
  __resetPreCloseFlushesForTest,
} from "@/lib/pre-close-flush"
import { createDebouncedPersist } from "@/lib/debounced-persist"

const REPO = resolve(__dirname, "../..")
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8").replace(/\r\n/g, "\n")

/**
 * 抠出源码里**每一次** `callee(…)` 的实参原文（按括号配平）。
 *
 * 为什么要抠实参，而不是在整份文件里 `toContain` —— 这是本轮终审查出的
 * 第二条真缺陷，值得完整记下来：
 *
 * 原来的接线守卫是三条**文件级子串**断言：
 *     src.toContain("registerPreCloseFlush(")
 *     src.toContain("persist.flushAsync()")
 *     src.not.toMatch(/registerPreCloseFlush\(\(\)\s*=>\s*persist\.flush\(\)\)/)
 * 实测把注册处退回"只启动不等待"（本修复要防的那个缺陷本身），
 * **三条全过**：
 *   · `persist.flushAsync()` 在卸载清理那一行还有一份 → `toContain` **永远满足**；
 *   · 那个正则只匹配 `() => persist.flush()` 这一个精确单行形态，
 *     写成 `() => { void persist.flush() }` 或换行就绕开。
 * 也就是说：**缺陷回归而守卫全绿**，而这三条断言打印的还是"关窗前落盘必须用 flushAsync"。
 * 根因和本轮最贵的那条教训是同一个 —— 断言测的是"某个字符串在这份文件里出现过"，
 * 不是"注册的那一个动作究竟是哪个"。名字出现过 ≠ 接线是对的。
 *
 * 抠出实参之后，判定落在**注册的那一个动作本身**上：它必须含 `flushAsync`，
 * 且不得出现同步 `flush(`。任何写法（大括号、`void`、换行、`.flush( )`）都绕不开。
 *
 * 括号不配平（源码坏了）时返回空数组 —— 调用方必须把"一个都没抠到"判红，
 * 不许把"抠不到"当成"没问题"。
 */
function extractCallArgs(src: string, callee: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = src.indexOf(`${callee}(`, from)
    if (at < 0) return out
    const open = at + callee.length
    let depth = 0
    let close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === "(") depth += 1
      else if (src[i] === ")") { depth -= 1; if (depth === 0) { close = i; break } }
    }
    if (close < 0) return out // 括号不配平：返回已抠到的，调用方看到数量不对会报红
    out.push(src.slice(open + 1, close))
    from = close + 1
  }
}

beforeEach(() => { __resetPreCloseFlushesForTest() })

describe("pre-close-flush 注册表", () => {
  it("执行全部已注册动作，且每个都真的 await 完", async () => {
    const order: string[] = []
    registerPreCloseFlush(async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a") })
    registerPreCloseFlush(async () => { order.push("b") })
    const res = await runPreCloseFlushes()
    // 关键：runPreCloseFlushes resolve 之后，动作必须**已经跑完**。
    // 若这里不 await，destroy() 会把写盘切断，缺陷原样保留。
    expect(order).toEqual(["a", "b"])
    expect(res).toEqual({ ran: 2, failed: 0 })
  })

  it("一个失败不阻断其它（否则一个模块写盘失败会连带丢掉另一个模块的设置）", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const done: string[] = []
    registerPreCloseFlush(() => { throw new Error("写盘失败") })
    registerPreCloseFlush(async () => { done.push("second") })
    const res = await runPreCloseFlushes()
    expect(done).toEqual(["second"])
    expect(res).toEqual({ ran: 1, failed: 1 })
    spy.mockRestore()
  })

  it("注销后不再执行（组件卸载必须注销，否则残留闭包）", async () => {
    const fn = vi.fn()
    const unregister = registerPreCloseFlush(fn)
    expect(preCloseFlushCount()).toBe(1)
    unregister()
    expect(preCloseFlushCount()).toBe(0)
    await runPreCloseFlushes()
    expect(fn).not.toHaveBeenCalled()
  })

  it("空注册表不报错（没有写作现场时也要能正常关窗）", async () => {
    await expect(runPreCloseFlushes()).resolves.toEqual({ ran: 0, failed: 0 })
  })
})

describe("flushAsync 与 flush 的差别（这个差别正是缺陷的根）", () => {
  it("flushAsync 等到写盘结束；flush 只启动、不等待", async () => {
    let writeFinished = false
    const slow = () => new Promise<void>((r) => setTimeout(() => { writeFinished = true; r() }, 30))

    const p1 = createDebouncedPersist(10_000)
    p1.schedule(slow)
    await p1.flushAsync()
    expect(writeFinished, "flushAsync 必须等到写盘结束").toBe(true)

    // 反向对照：flush() 不等 —— 这正是为什么关窗流程不能用它。
    writeFinished = false
    const p2 = createDebouncedPersist(10_000)
    p2.schedule(slow)
    p2.flush()
    expect(writeFinished, "flush() 是 void task()，返回时写盘尚未完成").toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    expect(writeFinished).toBe(true)
  })

  it("flushAsync 会取消定时器，不会让同一次改动写两遍", async () => {
    const fn = vi.fn(async () => {})
    const p = createDebouncedPersist(40)
    p.schedule(fn)
    await p.flushAsync()
    await new Promise((r) => setTimeout(r, 90))
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe("接线：必须真的接上，否则注册表再对也没用", () => {
  /*
   * 先证明**抠实参的工具本身**是对的。它是这条守卫的新地基：
   * 抠错了（比如把整段大括号也算进去、或者少抠一个字符），
   * 上面那条判定就会在错误的文本上做判断，而结果可能照样是绿的。
   * 本仓库的老教训：检查器的范围与工具本身也是判据的一部分。
   */
  it("抠实参工具自身：各种写法都要抠准，抠不到时不许假装抠到了", () => {
    // 不同写法都必须抠出**逐字精确**的实参原文
    /*
     * ⚠ 断言必须写精确值，不能用"结尾不是 `)`"这种形状判据。
     * 我第一版就写了 `.not.toMatch(/^\(|\)$/)`，结果在
     * `() => persist.flushAsync()` 上误报 —— 实参**天然**以 `)` 结尾
     * （那是 `flushAsync()` 的括号），这个正则根本表达不了"别把外层括号抠进来"。
     * 假红的原因和假绿一样：**判据的形状没有对准它要说的那件事**。
     */
    const shapes: [string, string][] = [
      ["registerPreCloseFlush(() => persist.flushAsync())", "() => persist.flushAsync()"],
      ["registerPreCloseFlush(() => { void persist.flushAsync() })", "() => { void persist.flushAsync() }"],
      ["registerPreCloseFlush(\n      () => persist.flushAsync(),\n    )", "\n      () => persist.flushAsync(),\n    "],
      ["registerPreCloseFlush(() =>\n      persist.flushAsync()\n    )", "() =>\n      persist.flushAsync()\n    "],
    ]
    for (const [s, want] of shapes) {
      const args = extractCallArgs(s, "registerPreCloseFlush")
      expect(args, `抠不出实参：${s}`).toHaveLength(1)
      expect(args[0], `实参抠错：${s}`).toBe(want)
    }

    // 嵌套括号必须配平：不能在内层 `)` 就截断
    const nested = extractCallArgs("registerPreCloseFlush(() => f(a, g(b), c))", "registerPreCloseFlush")
    expect(nested).toEqual(["() => f(a, g(b), c)"])

    // 多次注册都要抠到（否则第二处接线就没人守）
    const twice = extractCallArgs("registerPreCloseFlush(() => a())\nregisterPreCloseFlush(() => b())", "registerPreCloseFlush")
    expect(twice).toEqual(["() => a()", "() => b()"])

    // 抠不到就是空集，调用方必须据此报红（不许静默通过）
    expect(extractCallArgs("const x = 1", "registerPreCloseFlush")).toEqual([])
    // 括号不配平：不许凭空造出一个实参
    expect(extractCallArgs("registerPreCloseFlush(() => a()", "registerPreCloseFlush")).toEqual([])
  })

  it("preview-panel 注册了关窗前落盘，且注册的**那一个动作**用的是 flushAsync 而不是 flush", () => {
    const src = read("src/components/layout/preview-panel.tsx")
    const args = extractCallArgs(src, "registerPreCloseFlush")
    expect(args.length, "preview-panel 未注册关窗前落盘 —— 关窗口仍会丢最后一次改动").toBeGreaterThan(0)

    /*
     * 只判定**与正文排版 persist 有关**的那些注册：将来若有人为别的模块
     * 注册一个别的异步落盘动作，不该被这条判据误伤（那是假红）。
     * 但"一个相关的都没找到"必须报红 —— 否则改个变量名就能让判据变空集。
     */
    const persistArgs = args.filter((a) => a.includes("persist"))
    expect(persistArgs.length, "注册里找不到与正文排版 persist 有关的动作 —— 判据成了空集（改名即失效）").toBeGreaterThan(0)

    for (const arg of persistArgs) {
      expect(arg, `关窗前落盘必须用 flushAsync（flush 只启动不等待，destroy 会切断写盘）。实际注册的是：${arg.trim()}`)
        .toContain("flushAsync")
      expect(arg, `注册的落盘动作调用了同步 flush() —— 它只启动不等待，等于白做。实际注册的是：${arg.trim()}`)
        .not.toMatch(/\.flush\s*\(/)
    }
  })

  it("preview-panel 卸载时注销注册（否则残留已卸载组件的闭包）", () => {
    const src = read("src/components/layout/preview-panel.tsx")
    expect(src, "注册了却没注销：卸载后旧闭包会留在表里").toContain("unregister()")
  })

  it("App 的关闭流程在 destroy 之前 await 执行了这些落盘", () => {
    const src = read("src/App.tsx")
    const flushIdx = src.indexOf("runPreCloseFlushes()")
    const destroyIdx = src.indexOf("getCurrentWindow().destroy()")
    expect(flushIdx, "App 未调用 runPreCloseFlushes（排版设置会在关窗时丢）").toBeGreaterThan(-1)
    expect(destroyIdx).toBeGreaterThan(-1)
    expect(flushIdx, "runPreCloseFlushes 必须在 destroy 之前，否则窗口已经销毁").toBeLessThan(destroyIdx)
    expect(src, "runPreCloseFlushes 必须 await，否则 destroy 切掉未完成的写盘").toMatch(/await runPreCloseFlushes\(\)/)

    /*
     * ── 失败必须**可见**（本轮终审第 6 条）──
     *
     * `runPreCloseFlushes()` 内部吞掉每个异常、把它们记进返回值的 `failed`，
     * 所以它**不会 reject** —— 只写 `.catch(...)` 是兜不住落盘失败的。
     * 原来就是这个写法：`failed > 0` 时唯一痕迹是一行 console.error，
     * 紧接着就 destroy()，用户永远看不到，"关窗前落盘失败"事实上不可观测。
     *
     * 这里要求调用处**真的读了返回值**并处理失败分支。
     * 只断言"出现过 .failed 字样"太弱（注释里也能有），所以断言的是：
     * 返回值得被接住（`const … = await runPreCloseFlushes()`），
     * 且存在一个 `failed > 0` 的分支。
     */
    expect(src, "runPreCloseFlushes 的返回值被丢弃 —— 落盘失败将完全不可观测（它不会 reject，.catch 兜不住）")
      .toMatch(/await runPreCloseFlushes\(\)/)
    expect(src, "没有接住 runPreCloseFlushes 的返回值").toMatch(/=\s*await runPreCloseFlushes\(\)/)
    expect(src, "没有处理 failed > 0 的分支 —— 落盘失败仍然不可观测").toMatch(/\.failed\s*>\s*0/)
  })

  it("注释不许再声称「关窗口那条路径已被卸载 flush 覆盖」（那正是旧注释的错误）", () => {
    const src = read("src/components/layout/preview-panel.tsx")
    // 实测确认：destroy() 销毁 webview，React 不走 unmount。
    // 旧注释把①这条路径说成已被覆盖，属于"说谎注释"，必须改成说明注册表。
    expect(src, "注释仍把「关窗口」说成由卸载 flush 覆盖").not.toMatch(/拖完滑块 400ms 内直接关窗口 \/ Alt\+F4（走 Tauri 的关闭，没有 mousedown）\s*\n\s*\*?\s*②/)
    expect(src).toContain("React 不走 unmount")
  })
})

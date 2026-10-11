#!/usr/bin/env node
/**
 * 在**真实 exe** 上验证阶段 3 + 阶段 4 的字体功能，端到端。
 *
 * ── 为什么必须跑真实 exe，而不是只看单测 ──
 * 单元测试能证明「枚举逻辑对」「sys: 取值能被归一化」，
 * 但证明不了这三件只有把整条链路接起来才成立的事：
 *   ① 随包字体**真的**被应用安装到了用户字体目录并写进注册表；
 *   ② 被安装的字体**真的**能被 DirectWrite 看到（注册表写对了不代表系统认）；
 *   ③ 设置页下拉里**真的**出现了这些字体，且选中后界面真的是那个字形。
 * 历史上本项目出过的正是"装上了、列表里没有"与"选了没反应"这类
 * 单测全绿、用户却看不生效的缺陷。
 *
 * 用法：
 *   node docs/font-scaling-fix-20261007/verify-real-exe-fonts.mjs
 *   node docs/font-scaling-fix-20261007/verify-real-exe-fonts.mjs --attach --port 9333
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawn, execFileSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")
const argv = process.argv.slice(2)
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const EXE = argOf("--exe") ?? join(REPO, "release-portable", "QMaiWrite.exe")
const FONTS_DIR = argOf("--fonts-dir") ?? join(REPO, "release-portable", "fonts")
const PORT = Number(argOf("--port") ?? 9333)
const ATTACH = argv.includes("--attach")
const KEEP_OPEN = argv.includes("--keep-open")
const OUT = argOf("--out") ?? join(HERE, "real-exe-fonts-evidence.json")

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const fails = []
const notes = []

/**
 * 读本用户字体注册表：`值名 -> 字体文件绝对路径`。
 *
 * 用 `reg.exe query` 而不是原生模块：这是**真实机器验证**脚本，
 * 目的正是绕开"我们自己的代码"，直接看系统里到底写了什么。
 * 读不到时返回 null（由调用方决定是跳过还是失败），
 * 不返回空 Map —— 空 Map 会让"一个值都没有"看起来像"检查通过了"。
 */
function readFontRegistryValues() {
  const KEY = "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"
  try {
    const out = execFileSync("reg.exe", ["query", KEY], { encoding: "utf8", windowsHide: true })
    const map = new Map()
    for (const line of out.split(/\r?\n/)) {
      /*
       * reg query 输出形如：`    Source Han Serif SC (TrueType)    REG_SZ    C:\...\x.otf`
       * 值名里本来就可能含空格/括号，所以按 `REG_SZ` 这个分隔标记切，
       * 不用 `\s+` 去 split —— 那会把名字里的空格也切碎。
       */
      const m = /^\s{4}(.+?)\s{4}REG_SZ\s{4}(.*)$/.exec(line)
      if (m) map.set(m[1].trim(), m[2].trim())
    }
    // 连表头都没解析出来说明输出格式变了，不能当成"0 个值"放过去
    return map.size > 0 ? map : null
  } catch {
    return null
  }
}

async function loadPlaywright() {
  for (const c of [join(process.env.APPDATA ?? "", "npm/node_modules/playwright/index.js"), join(REPO, "node_modules/playwright/index.js")]) {
    if (existsSync(c)) { const mod = await import(pathToFileURL(c).href); return mod.chromium ?? mod.default?.chromium }
  }
  throw new Error("找不到 playwright")
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { const res = await fetch(`http://127.0.0.1:${port}/json/version`); if (res.ok) return await res.json() } catch {}
    await wait(500)
  }
  throw new Error(`等待 CDP 端口 ${port} 超时`)
}

/**
 * 页面内：读出两个字体下拉的全部分组与选项，以及当前生效的字体族。
 *
 * 注意 `page.evaluate(fn, ...args)` 在本项目的 WebView2 上**多于一个参数会抛错**，
 * 故这里不传参，全部在页面内自己取。
 */
const READ_SELECTS = () => {
  const dump = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    return {
      label: el.getAttribute("aria-label"),
      value: el.value,
      groups: Array.from(el.querySelectorAll("optgroup")).map((g) => ({
        label: g.label,
        options: Array.from(g.querySelectorAll("option")).map((o) => ({ value: o.value, text: o.textContent?.trim() })),
      })),
    }
  }
  const root = document.documentElement
  const cs = getComputedStyle(root)
  return {
    ui: dump('select[aria-label="界面字体"]'),
    body: dump('select[aria-label="正文字体"]'),
    uiFontVar: cs.getPropertyValue("--qmai-ui-font-family").trim(),
  }
}

/**
 * 页面内：把某个下拉设成给定值并派发 change（React 受控组件需要原生 setter）。
 *
 * ⚠️ 参数必须是**单个对象**。本项目 WebView2 上的 `page.evaluate(fn, a, b)`
 * 会抛 `Too many arguments. If you need to pass more than 1 argument to the
 * function wrap them in an object.` —— 这是 CDP 的限制，不是代码错误。
 * 我第一版就是按 `(sel, value)` 两个参数写的，于是"选中"这一步直接失败，
 * 而失败信息看起来像"受控组件把值弹回去了"，把结论引向了**错误的产品缺陷**。
 * 凡是多于一个入参，一律包成对象。
 */
const SET_SELECT = ({ sel, value }) => {
  const el = document.querySelector(sel)
  if (!el) return { ok: false, reason: "找不到下拉" }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
  return { ok: true }
}

/**
 * 页面内：用 canvas **光栅化**两段文字，比较像素，判断字形是否真的不同。
 *
 * ── 为什么不能用宽度 ──
 * 对中文来说，汉字宽度基本都是全角 1em —— `宋体` 与 `楷体` 渲染同一串汉字，
 * 总宽度**完全相同**。用宽度判断"字体生效没有"必然得出"没生效"的错误结论
 * （或反过来，两个都在 1em 就永远"相等"）。这是中文特有的陷阱，
 * 用英文样本试出来的经验在这里不成立。
 *
 * ── 因此改为比较像素 ──
 * 同一段文字用不同字体光栅化，得到的点阵必然不同。为了排除"两次渲染本来
 * 就有随机差异"这种可能，函数返回三组哈希：
 *   · targetSelf / targetSelf2：**同一字体渲染两次** —— 必须相同。
 *     这是确定性对照：若这两者都不同，说明测量本身不可信，
 *     那么 target vs other 的差异也不能作为证据。
 *   · other：另一款字体 —— 与 target 不同才说明"字形真的变了"。
 */
const RASTER_COMPARE = ({ target, other, text }) => {
  const hash = (family) => {
    const W = 900, H = 140
    const cv = document.createElement("canvas")
    cv.width = W; cv.height = H
    const ctx = cv.getContext("2d")
    if (!ctx) return null
    // 白底黑字，避免透明通道带来的差异
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = "#000"
    ctx.font = `72px ${JSON.stringify(family)}`
    ctx.textBaseline = "top"
    ctx.fillText(text, 8, 24)
    const data = ctx.getImageData(0, 0, W, H).data
    // FNV-1a，够用且无需依赖
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193) >>> 0 }
    // 顺带统计墨迹像素数：能区分"整段没渲染出来"与"渲染了但形状不同"
    let ink = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) ink++
    return { hash: h.toString(16), ink }
  }
  return {
    targetSelf: hash(target),
    targetSelf2: hash(target),
    other: hash(other),
  }
}

async function main() {
  const manifestPath = join(FONTS_DIR, "fonts-manifest.json")
  if (!existsSync(manifestPath)) {
    console.log(`  ✗ 找不到运行期清单：${manifestPath}`)
    console.log("    便携版必须先执行 node scripts/build-portable.mjs")
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  console.log(`  运行期清单：${manifest.fonts.length} 款`)

  const chromium = await loadPlaywright()
  let child = null
  if (!ATTACH) {
    if (!existsSync(EXE)) { console.log(`  ✗ 找不到便携版: ${EXE}`); process.exit(1) }
    console.log(`  启动: ${EXE}`)
    child = spawn(EXE, [], {
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
      stdio: "ignore",
      cwd: dirname(EXE),
    })
    child.on("error", (e) => console.log(`  exe 启动错误: ${e.message}`))
  }
  const version = await waitForCdp(PORT, 120_000)
  console.log(`  CDP 就绪: ${version.Browser ?? "(未知)"}`)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  // connectOverCDP 的 browser.close() 可能永久挂住（它想去关真实浏览器进程）
  const bye = async () => { try { await Promise.race([browser.close(), wait(4000)]) } catch {} }

  let page = null
  const pd = Date.now() + 90_000
  while (Date.now() < pd && !page) {
    for (const c of browser.contexts()) {
      for (const p of c.pages()) {
        const u = p.url() ?? ""
        /*
         * 必须排除 `about:blank`。
         *
         * WebView2 启动时会先出现一个 `about:blank` 页面，应用真正的页面
         * （`tauri://localhost/…` 或 `http://tauri.localhost/…`）稍后才建出来。
         * 只排除 `devtools://` 的话就会抓住这个空白页 —— 脚本随后在它上面
         * 找不到任何设置入口，报出"找不到设置入口"这种**看起来像产品缺陷、
         * 实际是测量时机错误**的结论。
         */
        if (!u || u === "about:blank" || u.startsWith("devtools://")) continue
        page = p
        break
      }
      if (page) break
    }
    if (!page) await wait(500)
  }
  if (!page) { console.log("  ✗ 找不到应用页面"); await bye(); if (child && !KEEP_OPEN) child.kill(); process.exit(1) }
  console.log(`  页面: ${page.url()}`)
  await page.waitForLoadState("domcontentloaded").catch(() => {})
  await wait(3000)

  const evidence = { exe: EXE, manifestCount: manifest.fonts.length, steps: {} }

  /* ── 一、打开设置页并切到「界面」分组 ── */
  console.log("")
  console.log("  ══ 一、打开设置 → 界面 ══")
  /*
   * 导航路径不是"点一个『设置』按钮"，实测有三步，每一步都有原因：
   *
   * ① 写作工作区（wiki 视图）**不显示全局图标侧栏** —— 那里是
   *    `WritingWorkspace` 自己的侧栏（大纲/章节/灵魂/拆书库）。
   *    全局栏（含齿轮图标）只在书架等视图出现，所以必须先回书架。
   * ② 齿轮按钮**没有 aria-label / 文本**，只有 `<svg class="lucide-settings">`。
   *    按文本或 aria-label 找必然找不到 —— 我第一版就是这么写的，
   *    结果报出"找不到设置入口"，看起来像产品缺陷，其实是选择器错。
   *    这里用 svg 的 lucide class 定位，再取它所属的 <button>。
   * ③ 「界面」是设置分类里的一个 tab，默认停在「模型设置」，必须再点一次。
   */
  const back = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((e) => (e.getAttribute("aria-label") ?? "") === "返回书架")
    if (!b) return { ok: false, reason: "找不到「返回书架」" }
    b.click()
    return { ok: true }
  })
  console.log(`  ① 回书架: ${back.ok ? "成功" : `跳过（${back.reason}）—— 可能已在书架`}`)
  await wait(3500)

  const opened = await page.evaluate(() => {
    const ic = document.querySelector("svg.lucide-settings") ?? document.querySelector('[class*="lucide-settings"]')
    if (!ic) return { ok: false, reason: "找不到 lucide-settings 图标" }
    const btn = ic.closest("button")
    if (!btn) return { ok: false, reason: "图标不在 button 内" }
    btn.click()
    return { ok: true }
  })
  console.log(`  ② 点设置齿轮: ${opened.ok ? "成功" : `失败：${opened.reason}`}`)
  if (!opened.ok) fails.push(`无法打开设置页：${opened.reason}`)
  await wait(4000)

  const tabbed = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll("button")).find((el) => /^界面\s*$/.test((el.textContent ?? "").trim()) && el.offsetParent !== null)
    if (!t) return { ok: false, reason: "找不到「界面」分类" }
    t.click()
    return { ok: true }
  })
  console.log(`  ③ 切到「界面」: ${tabbed.ok ? "成功" : `失败：${tabbed.reason}`}`)
  if (!tabbed.ok) fails.push(`无法切到界面分类：${tabbed.reason}`)
  await wait(3000)

  let selects = null
  const sd = Date.now() + 30_000
  while (Date.now() < sd) {
    selects = await page.evaluate(READ_SELECTS).catch(() => null)
    if (selects?.ui) break
    await wait(1000)
  }
  if (!selects?.ui) {
    console.log("  ✗ 读不到界面字体下拉，无法继续")
    await bye(); if (child && !KEEP_OPEN) child.kill(); process.exit(1)
  }
  evidence.steps.selects = selects
  await page.screenshot({ path: join(HERE, "real-exe-fonts-01-下拉.png") }).catch(() => {})

  /*
   * ── 一·补、界面上必须有鸿蒙黑体的许可告知 ──
   *
   * 鸿蒙黑体的许可（HarmonyOS Sans Fonts License Agreement）第 2 条第 1 项是
   * **强制**义务：
   *   `YOU shall make a prominent notice in the software to state that
   *    HarmonyOS Sans Fonts are used.`
   *
   * 关键词是 **in the software** —— 所以这条只能在**真实 exe** 里验：
   * jsdom 里的 `interface-section.spec.tsx` 证明的是"组件会渲染这几个节点"，
   * 证明不了"用户真的能在软件里看到它"（比如设置页根本没挂载这个分区、
   * 或者构建产物里丢了这段）。许可义务要的正是后者。
   */
  console.log("")
  console.log("  ══ 一·补、界面上的第三方字体许可告知（鸿蒙黑体的强制义务）══")
  const notice = await page.evaluate(() => {
    const section = document.querySelector('[data-ui="bundled-font-licenses"]')
    const noticeEl = document.querySelector('[data-ui="harmonyos-notice"]')
    const items = Array.from(document.querySelectorAll('[data-ui="bundled-font-license-list"] li'))
    // 可见性：许可要求"显著"，藏起来（display:none / 0 尺寸）不算
    const visible = (el) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0
    }
    return {
      hasSection: !!section,
      sectionVisible: visible(section),
      noticeText: (noticeEl?.textContent ?? "").trim(),
      noticeVisible: visible(noticeEl),
      itemCount: items.length,
      items: items.map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim()),
    }
  }).catch((e) => ({ error: String(e) }))

  if (notice?.error) {
    fails.push(`读取许可告知失败：${notice.error}`)
    console.log(`  ✗ 读取失败：${notice.error}`)
  } else {
    evidence.steps.notice = notice
    console.log(`  告知区存在=${notice.hasSection} 可见=${notice.sectionVisible} 条目=${notice.itemCount}`)
    if (!notice.hasSection) {
      fails.push("界面上找不到随包字体许可告知区（data-ui=\"bundled-font-licenses\"）")
    } else if (!notice.sectionVisible) {
      // 允许出现在折页/详情里，但必须有可见尺寸 —— 完全不可见就不满足"显著"
      fails.push("许可告知区存在但不可见（尺寸为 0 或被 display:none 隐藏）—— 不满足许可的『显著注明』")
    }
    // 显著声明必须点名 HarmonyOS Sans
    if (!/HarmonyOS Sans/i.test(notice.noticeText)) {
      fails.push(`显著声明没有点名 HarmonyOS Sans（实际读到：${JSON.stringify(notice.noticeText)}）`)
    } else if (!notice.noticeVisible) {
      fails.push("显著声明存在但不可见 —— 不满足许可的『显著注明』")
    } else {
      console.log(`  ✓ 显著声明可见且点名 HarmonyOS Sans：${JSON.stringify(notice.noticeText)}`)
    }
    // 9 个族都要列出来，且每条都要带版权行
    if (notice.itemCount !== 9) {
      fails.push(`许可告知列出的字体条目数是 ${notice.itemCount}，期望 9（9 个随包族）`)
    } else {
      const lacksCopyright = notice.items.filter((t) => !/Copyright|©/i.test(t))
      if (lacksCopyright.length) {
        fails.push(`有 ${lacksCopyright.length} 条没有版权行：${JSON.stringify(lacksCopyright)}`)
      } else {
        console.log(`  ✓ 9 个随包族都列出且都带版权行`)
      }
    }
  }

  /* ── 二、随包字体必须出现在「本机中文字体」分组里 ── */
  console.log("")
  console.log("  ══ 二、随包字体是否出现在下拉里 ══")
  const sysGroup = selects.ui.groups.find((g) => g.label === "本机中文字体")
  if (!sysGroup) {
    fails.push("界面字体下拉里没有「本机中文字体」分组 —— 随包字体没有被枚举出来")
    console.log("  ✗ 没有「本机中文字体」分组")
  } else {
    console.log(`  「本机中文字体」分组：${sysGroup.options.length} 项`)
    const sysValues = new Set(sysGroup.options.map((o) => o.value))
    /*
     * 按**族**去重，不按清单条目。
     *
     * 清单现在是 11 个文件但只有 9 个族：思源宋体/思源黑体各有 Regular 与 Bold，
     * 却共用同一个 `sys:<族名>` 取值 —— 下拉里是 9 项，不是 11 项。
     * 若按条目去断言并打印"全部 11 款都能选到"，数字看着对、说法是错的：
     * 那会让人以为下拉里有 11 项，从而在真出问题时（少了一族）
     * 因为"11 个条目都命中"而看不出来。
     */
    const families = [...new Set(manifest.fonts.map((f) => f.family))]
    console.log(`  清单 ${manifest.fonts.length} 个文件 / ${families.length} 个族（同族多字重共用同一个取值）`)
    // 每款随包族都应能被选中。用 family 组成 sys: 取值来核对。
    // 标题里带括号/空格的族名（如 Zhuque Fangsong (technical preview)）
    // 是最容易在拼接环节出错的一类，所以这里逐族比对而不是只看数量。
    const missing = []
    for (const fam of families) {
      const want = `sys:${fam}`
      const hit = sysValues.has(want)
      console.log(`    ${hit ? "✓" : "✗"} ${want}`)
      if (!hit) missing.push(`期望取值 ${want}`)
    }
    if (missing.length) {
      fails.push(`以下随包字体族没有出现在下拉里：${missing.join("；")}`)
    } else {
      console.log(`  ✓ 全部 ${families.length} 个随包字体族都能在下拉里选到`)
    }
    // 拉丁字体不该出现（负向对照）
    const latin = sysGroup.options.filter((o) => /^(Arial|Segoe UI|Times New Roman|Calibri|Consolas|Verdana)$/i.test(o.value.replace(/^sys:/, "")))
    if (latin.length) fails.push(`下拉里出现了纯拉丁字体：${latin.map((o) => o.value).join(", ")}`)
    else console.log("  ✓ 未出现纯拉丁字体（负向对照通过）")
  }

  /*
   * ── 二·补、同族多字重必须写成**不同的注册表值名** ──
   *
   * 这是本轮实测发现的真实缺陷，也是加 Bold 时最容易被漏掉的一步：
   * 值名是系统字体表里的唯一键，只用族名拼的话，同族的 Regular 与 Bold 会
   * 互相覆盖 —— 磁盘上多一个文件、系统里少一档字重，而用户只看到"加粗没变化"。
   *
   * 上面那些检查全都**测不出**这个缺陷：字体装了、下拉里也有、选谁都能换字形。
   * 所以必须直接看注册表：同族不能只有一个值名，且必须指向不同文件。
   */
  console.log("")
  console.log("  ══ 二·补、同族多字重的注册表值名是否互不相同 ══")
  const valueNames = readFontRegistryValues()
  if (!valueNames) {
    notes.push("ⓘ 未能读取 HKCU 字体注册表（reg.exe 不可用？），跳过同族多字重检查")
    console.log("  ⓘ 跳过：读不到注册表")
  } else {
    /*
     * 按**文件名**匹配，不按值名匹配 —— 这是一个刻意的选择。
     *
     * 按值名（`base === fam || base.startsWith(fam + " ")`）匹配会误纳
     * 机器上**本来就有的**字体：本机基线里就有
     * `Source Han Serif SC Heavy (TrueType)` → `C:\Windows\Fonts\...ttf`。
     * 它名字以 "Source Han Serif SC " 开头，于是会被算进思源宋体这一族，
     * 让"该族有 ≥2 个值名"在 Bold **根本没装**时也成立 —— 一个典型的
     * 看起来在检验、其实什么都没检验的假绿。
     *
     * 改成"清单里的每个文件是否都作为某个注册表值的**目标**出现"，
     * 就与命名规则无关、也不会被同名的其他字体干扰。
     */
    const byFile = new Map()
    for (const [name, path] of valueNames) {
      byFile.set(path.split(/[\\/]/).pop().toLowerCase(), name)
    }
    const multiWeightFamilies = [...new Set(manifest.fonts.map((f) => f.family))].filter(
      (fam) => manifest.fonts.filter((f) => f.family === fam).length > 1,
    )
    console.log(`  注册表值 ${valueNames.size} 个；清单里有多字重的族：${multiWeightFamilies.length} 个`)
    if (multiWeightFamilies.length === 0) {
      // 不写"通过"：没有多字重族时这条检查什么也没测到
      notes.push("ⓘ 清单里没有多字重族，同族多字重检查未生效（加 Bold 后应至少有 2 个）")
      console.log("  ⓘ 清单里没有多字重族，本条无从检验")
    }
    const weightProblems = []
    const detail = {}
    for (const fam of multiWeightFamilies) {
      const files = manifest.fonts.filter((f) => f.family === fam)
      const rows = files.map((f) => ({
        file: f.file,
        weight: f.weight,
        valueName: byFile.get(f.file.toLowerCase()) ?? null,
      }))
      detail[fam] = rows
      const registered = rows.filter((r) => r.valueName)
      const names = registered.map((r) => r.valueName)
      const distinctNames = new Set(names)
      console.log(`    ${fam}：清单 ${files.length} 个文件，注册表里 ${registered.length} 个已注册`)
      for (const r of rows) {
        console.log(
          `      ${r.valueName ? "✓" : "✗"} w=${String(r.weight).padEnd(4)} ${r.file.padEnd(30)} → ${r.valueName ?? "（注册表里没有）"}`,
        )
      }
      for (const r of rows) {
        if (!r.valueName) {
          weightProblems.push(
            `${fam} 的 ${r.file}（字重 ${r.weight}）已装到磁盘但注册表里没有任何值指向它 —— 该字重对系统不可见`,
          )
        }
      }
      if (registered.length === files.length && distinctNames.size < files.length) {
        weightProblems.push(
          `${fam}：${files.length} 个文件只写成了 ${distinctNames.size} 个不同值名（${[...distinctNames].join("、")}）—— ` +
            `同族字重撞在同一个键上，后写的覆盖先写的`,
        )
      }
    }
    if (weightProblems.length) fails.push(...weightProblems)
    else if (multiWeightFamilies.length > 0) {
      console.log("  ✓ 每个多字重族的各档字重都已注册，且值名互不相同")
    }
    evidence.steps.multiWeight = { count: valueNames.size, families: detail }
  }

  /* ── 三、选中随包字体后，界面真的换了字形 ── */
  console.log("")
  console.log("  ══ 三、选中随包字体 → 真换字形 ══")
  // 挑一款最可能明显不同的：寒蝉正楷体（楷体）
  const target = manifest.fonts.find((f) => f.id === "chillkai") ?? manifest.fonts[0]
  const targetValue = `sys:${target.family}`
  // 对照组选一款**字形差别最大**的：宋体（衬线、横细竖粗）对楷体
  const otherFamily = "SimSun"
  /*
   * 记下改动前的值，最后还原。
   *
   * 这个脚本跑在**用户的真实应用**上，改的是**用户的真实设置**
   * （app-state.json 的 `uiFontFamily`）。第一版没有还原，跑一次就把用户的
   * 界面字体永久留在测试字体上 —— 对用户来说就是"我什么都没点，
   * 界面字体自己变了"。验收脚本污染被测系统，比测不出问题更糟。
   */
  const originalValue = selects.ui.value
  const applied = await page.evaluate(SET_SELECT, { sel: 'select[aria-label="界面字体"]', value: targetValue }).catch((e) => ({ ok: false, reason: String(e) }))
  console.log(`  选中 ${target.display}（${targetValue}）：${applied.ok ? "已派发 change" : `失败 ${applied.reason}`}`)
  await wait(2000)

  /*
   * 设置页是「草稿 + 保存」模式：改动只进 draft，必须点保存才会写进 store、
   * 进而改变 `--qmai-ui-font-family`。不点保存就断言 CSS 变量，会得出
   * "选了没反应"的错误结论 —— 而这恰好是本次要验证的那个病症，
   * 二者混淆会非常危险。
   */
  const saved = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button"))
      .find((el) => /^保存/.test((el.textContent ?? "").trim()) && el.offsetParent !== null && !el.disabled)
    if (!btn) return { ok: false, reason: "找不到可用的保存按钮" }
    btn.click()
    return { ok: true, text: (btn.textContent ?? "").trim().slice(0, 16) }
  })
  console.log(`  点保存（${saved.text ?? saved.reason}）：${saved.ok ? "成功" : "失败"}`)
  if (!saved.ok) notes.push(`未能点击保存：${saved.reason} —— 后续对 CSS 变量的断言可能因此不成立`)
  await wait(3500)

  const after = await page.evaluate(READ_SELECTS).catch(() => null)
  const raster = await page
    .evaluate(RASTER_COMPARE, { target: target.family, other: otherFamily, text: "东国龙论车门永" })
    .catch((e) => ({ error: String(e) }))
  const uiFontVarAfter = after?.uiFontVar ?? ""
  console.log(`  选中后下拉值: ${after?.ui?.value ?? "(读不到)"}`)
  console.log(`  --qmai-ui-font-family: ${uiFontVarAfter}`)
  console.log(`  光栅化对比 ${target.family} vs ${otherFamily}:`)
  console.log(`    同字体两次      : ${raster?.targetSelf?.hash} / ${raster?.targetSelf2?.hash}（墨迹 ${raster?.targetSelf?.ink}）`)
  console.log(`    另一款字体      : ${raster?.other?.hash}（墨迹 ${raster?.other?.ink}）`)

  if (after?.ui?.value !== targetValue) {
    fails.push(`选中后下拉值变成了 ${after?.ui?.value}（期望 ${targetValue}）—— 受控组件把选择弹回去了`)
  }
  if (!uiFontVarAfter.includes(target.family)) {
    fails.push(`--qmai-ui-font-family 里没有 ${target.family}，字体没有真正应用：${uiFontVarAfter}`)
  }
  // 确定性对照：同一字体渲染两次必须逐像素一致，否则整个测量不可信
  if (raster?.targetSelf && raster?.targetSelf2) {
    if (raster.targetSelf.hash !== raster.targetSelf2.hash) {
      fails.push("同一字体渲染两次结果不同 —— 测量本身不可复现，后面的对比不能作为证据")
    }
  } else {
    fails.push(`光栅化测量失败：${raster?.error ?? "无结果"}`)
  }
  // 真实对照：目标字体与另一款字体必须渲染出不同点阵
  if (raster?.targetSelf && raster?.other) {
    if (raster.targetSelf.hash === raster.other.hash) {
      fails.push(`${target.family} 与 ${otherFamily} 渲染出的点阵完全相同 —— 说明请求的字体没有被真正使用（静默回退）`)
    } else if ((raster.targetSelf.ink ?? 0) < 50 || (raster.other.ink ?? 0) < 50) {
      fails.push(`渲染墨迹过少（${raster.targetSelf.ink} / ${raster.other.ink}），可能整段没画出来`)
    }
  }
  evidence.steps.selection = { target: targetValue, otherFamily, originalValue, afterValue: after?.ui?.value, uiFontVarAfter, raster }
  await page.screenshot({ path: join(HERE, "real-exe-fonts-02-选中后.png") }).catch(() => {})

  /* ── 四、还原用户原本的字体设置 ── */
  if (originalValue && originalValue !== targetValue) {
    console.log("")
    console.log("  ══ 四、还原用户原本的界面字体 ══")
    await page.evaluate(SET_SELECT, { sel: 'select[aria-label="界面字体"]', value: originalValue }).catch(() => {})
    await wait(1200)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find((el) => /^保存/.test((el.textContent ?? "").trim()) && el.offsetParent !== null && !el.disabled)
      btn?.click()
    }).catch(() => {})
    await wait(2500)
    const restored = await page.evaluate(READ_SELECTS).catch(() => null)
    const ok = restored?.ui?.value === originalValue
    console.log(`  还原为 ${originalValue}: ${ok ? "成功" : `失败（当前 ${restored?.ui?.value}）`}`)
    if (!ok) {
      // 还原失败必须显式告警：用户的设置被留在测试状态了
      notes.push(`⚠ 未能还原界面字体，用户设置可能仍为 ${restored?.ui?.value}，请手动改回 ${originalValue}`)
    }
    evidence.steps.restore = { originalValue, restoredValue: restored?.ui?.value, ok }
  }

  /* ── 收尾 ── */
  console.log("")
  console.log("  ══ 结论 ══")
  for (const n of notes) console.log(`  ⓘ ${n}`)
  if (fails.length === 0) {
    console.log("  ✓ 全部通过")
  } else {
    for (const f of fails) console.log(`  ✗ ${f}`)
  }
  evidence.fails = fails
  evidence.notes = notes
  writeFileSync(OUT, JSON.stringify(evidence, null, 2), "utf8")
  console.log(`  证据：${OUT}`)

  await bye()
  if (child && !KEEP_OPEN) { try { child.kill() } catch {} }
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.log(`  ✗ 异常：${e?.stack ?? e}`)
  process.exit(1)
})

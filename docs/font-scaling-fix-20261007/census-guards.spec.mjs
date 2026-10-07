/**
 * census-computed-font.mjs 的「防虚假通过」防线测试。
 *
 * 背景：一个会错误报「通过」的验收工具比没有工具更危险 —— 它会让未修复的缺陷
 * 看起来已修复。独立审查实测复现了 7 条虚假通过路径，全部 exit 0 并打印
 * 「字号修复已达成」。本文件把每一条钉死为永久用例。
 *
 * 测试方式：构造 fixtures（最小但形状真实：含 census["100"] / census["150"]、
 * 每条含 fontSize / lineHeight / inSvg / svgFontSizeAttr / isMarker、键带
 * `<分区id>::` 前缀），写入系统临时目录，**真实调用 CLI**（spawnSync node），
 * 断言退出码。
 *
 * 断言两点，避免「因为别的原因失败」而假绿：
 *   1. 退出码非 0；
 *   2. 失败来自工具自己的、带前缀的受控失败行（`GUARD-FAIL` = 防线、
 *      `ARG-FAIL` = 参数、`FAIL` = 判据未通过），而不是崩溃、ENOENT、
 *      语法错误之类的偶然非 0。
 *
 * 另有 3 条**正向对照**（必须退出 0）：干净 fixtures、真 SVG 例外仍被允许、
 * 以及每条负向用例都建立在同一套 fixture 生成器上 —— 若生成器本身坏掉，
 * 正向对照会立刻变红。
 *
 * 用例之间不共享任何可变状态：每个用例独立构造 payload 与临时文件。
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")
const TOOL = join(HERE, "census-computed-font.mjs")

/** 与工具内的 SETTINGS_SECTIONS 一致（11 个设置页分区）。 */
const SECTIONS = [
  "model", "novel", "network", "web-search", "interface", "user-memory",
  "maintenance", "data-management", "feedback", "contact-support", "changelog",
]

const TIMEOUT_MS = 120_000

const TMP_ROOT = mkdtempSync(join(tmpdir(), "qmai-census-guards-"))
afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true })
})

let seq = 0

/** 每个用例各自的临时文件（用例间不共享可变状态）。 */
function writeJson(payload) {
  const p = join(TMP_ROOT, `census-${Date.now()}-${seq++}.json`)
  writeFileSync(p, JSON.stringify(payload, null, 1), "utf8")
  return p
}

function px(n) {
  return `${Number(n.toFixed(4))}px`
}

/**
 * 构造形状真实的 census 桶。
 * 键 = `<分区id>::<DOM 路径>`，marker 条目再追加 `::marker`。
 * 字号 12/14/16px、行高 = 字号 × 1.5（整数或 .5，避免浮点噪声）。
 */
function buildBucket({
  sections = SECTIONS,
  fontSizeScale = 1,
  lineHeightScale = 1,
  keysPerSection = 3,
  markersPerSection = 1,
  mutate,
} = {}) {
  const out = {}
  for (const sec of sections) {
    for (let i = 0; i < keysPerSection; i++) {
      const base = 12 + 2 * i
      out[`${sec}::body:1>div:0>div:${i}`] = {
        fontSize: px(base * fontSizeScale),
        lineHeight: px(base * 1.5 * lineHeightScale),
        cls: `probe-${sec}-${i}`,
        text: `探针${i}`,
        inSvg: false,
        svgFontSizeAttr: false,
      }
    }
    for (let m = 0; m < markersPerSection; m++) {
      out[`${sec}::body:1>div:0>ul:${m}>li:0::marker`] = {
        fontSize: px(14 * fontSizeScale),
        lineHeight: px(21 * lineHeightScale),
        cls: "flex gap-2",
        text: "标记条目",
        inSvg: false,
        svgFontSizeAttr: false,
        isMarker: true,
      }
    }
  }
  if (mutate) mutate(out)
  return out
}

function fileOf(c100, c150) {
  return {
    capturedAt: "2026-10-07T00:00:00.000Z",
    scales: [100, 150],
    census: { 100: c100, 150: c150 },
  }
}

/** 一份干净、两侧键集一致、100% 等效、150% 全部 ×1.5 的 before/after 对。 */
function cleanPair() {
  return {
    before: fileOf(buildBucket(), buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })),
    after: fileOf(buildBucket(), buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })),
  }
}

function runTool(args) {
  const res = spawnSync(process.execPath, [TOOL, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  })
  return {
    status: res.status,
    signal: res.signal,
    errorCode: res.error?.code ?? null,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    get output() {
      return `${this.stdout}\n${this.stderr}`
    },
  }
}

/** 真实调用 `--compare`。 */
function runCompare(before, after, extraArgs = []) {
  const b = writeJson(before)
  const a = writeJson(after)
  return runTool(["--compare", b, a, ...extraArgs])
}

function expectFailure(res, kind = "GUARD-FAIL") {
  const detail = `\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`
  expect(res.status, `必须非 0（受控失败）。${detail}`).not.toBe(0)
  expect(
    res.output.includes(kind),
    `失败必须来自工具的受控失败行（含 "${kind}"），否则可能是崩溃/环境问题导致的偶然非 0。${detail}`,
  ).toBe(true)
}

function expectPass(res) {
  const detail = `\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`
  expect(res.status, `必须退出 0（正向对照）。${detail}`).toBe(0)
}

/** 每个用例都给足时间：参数解析若失效，采集模式会真的去启动浏览器。 */
const guardIt = (name, fn) => it(name, fn, TIMEOUT_MS)

describe("census-computed-font.mjs 防虚假通过防线", () => {
  /* ── 正向对照：先证明生成器与工具在正常输入上确实能通过 ── */

  guardIt("[对照] 干净 fixtures（两侧键集一致、100% 等效、150% 全部 ×1.5）→ 退出 0", () => {
    const { before, after } = cleanPair()
    expectPass(runCompare(before, after))
  })

  guardIt("[对照] 真 SVG 例外（inSvg && svgFontSizeAttr，未缩放）+ 显式配额 → 退出 0", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    // SVG <text> 带 font-size 呈现属性：不缩放是已登记的正确行为。
    // 例外判定读的是 100% 档的记录，故标记必须写在 a100 上（a150 保持同值 = 不缩放）。
    let n = 0
    for (const k of Object.keys(a100)) {
      if (!k.startsWith("changelog::") || k.endsWith("::marker")) continue
      a100[k] = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      a150[k] = { ...a100[k] }
      n++
    }
    // 例外配额默认 0（因为实测本机可达页面 svg 图元为 0 个）；
    // 要用例外必须**显式**给出配额 —— 这本身就是一次可见的、刻意的声明。
    expectPass(runCompare(before, fileOf(a100, a150), ["--max-svg-exceptions", String(n)]))
  })

  guardIt("[对照反面] 同样的真 SVG 例外，但不给配额 → 非 0（例外必须显式声明）", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    for (const k of Object.keys(a100)) {
      if (!k.startsWith("changelog::") || k.endsWith("::marker")) continue
      a100[k] = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      a150[k] = { ...a100[k] }
    }
    expectFailure(runCompare(before, fileOf(a100, a150)))
  })

  /* ── 缺陷 1：判据 2 无「参与元素下限」── */

  guardIt("缺陷1：after 的 150% 档为 {} → 非 0（不得在 0 个元素上判通过）", () => {
    const { before, after } = cleanPair()
    after.census["150"] = {}
    expectFailure(runCompare(before, after))
  })

  guardIt("缺陷1b：after 的 150% 档键数低于下限（--min-elements）→ 非 0", () => {
    const { before, after } = cleanPair()
    // 只保留前 12 个键（仍然非空、仍覆盖全部必要分区之外的最小集）
    const keep = Object.keys(after.census["100"]).slice(0, 12)
    const pick = (o) => Object.fromEntries(keep.filter((k) => k in o).map((k) => [k, o[k]]))
    after.census["100"] = pick(after.census["100"])
    after.census["150"] = pick(after.census["150"])
    expectFailure(runCompare(before, after, ["--min-elements", "100"]))
  })

  guardIt("缺陷1c：before 的 150% 档为 {} → 非 0（两侧档位都必须是非空对象）", () => {
    const { before, after } = cleanPair()
    before.census["150"] = {}
    expectFailure(runCompare(before, after))
  })

  /* ── 缺陷 2/3：局部或整体丢采集 ── */

  guardIt("缺陷3：after 的 150% 档丢掉 changelog 分区 → 非 0", () => {
    const { before, after } = cleanPair()
    after.census["150"] = buildBucket({
      sections: SECTIONS.filter((s) => s !== "changelog"),
      fontSizeScale: 1.5,
      lineHeightScale: 1.5,
    })
    expectFailure(runCompare(before, after))
  })

  guardIt("缺陷3b：after 的 150% 档只缺一个键 → 非 0（noPair 必须为 0）", () => {
    const { before, after } = cleanPair()
    const victim = Object.keys(after.census["150"])[0]
    delete after.census["150"][victim]
    expectFailure(runCompare(before, after))
  })

  guardIt("缺陷3c：after 的 150% 档多出一个键 → 非 0（两档键集必须一致）", () => {
    const { before, after } = cleanPair()
    after.census["150"]["changelog::body:1>div:0>div:99"] = {
      fontSize: "18px", lineHeight: "27px", cls: "x", text: "伪造", inSvg: false, svgFontSizeAttr: false,
    }
    expectFailure(runCompare(before, after))
  })

  /* ── 缺陷 4：整分区覆盖缺失（两侧同时缺，键数与判据自洽）── */

  guardIt("缺陷4：before/after 同时缺 changelog 分区 → 非 0（分区必须 11/11）", () => {
    const sectionIds = SECTIONS.filter((s) => s !== "changelog")
    const before = fileOf(
      buildBucket({ sections: sectionIds }),
      buildBucket({ sections: sectionIds, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    const after = fileOf(
      buildBucket({ sections: sectionIds }),
      buildBucket({ sections: sectionIds, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    expectFailure(runCompare(before, after))
  })

  guardIt("缺陷4b：::marker 条数为 0（前后两档都没有）→ 非 0", () => {
    const before = fileOf(
      buildBucket({ markersPerSection: 0 }),
      buildBucket({ markersPerSection: 0, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    const after = fileOf(
      buildBucket({ markersPerSection: 0 }),
      buildBucket({ markersPerSection: 0, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    expectFailure(runCompare(before, after))
  })

  /* ── 缺陷 5：判据 1 空转 ── */

  guardIt("缺陷5：before 的 100% 档为 {} → 非 0（判据 1 不得在空集上通过）", () => {
    const { before, after } = cleanPair()
    before.census["100"] = {}
    expectFailure(runCompare(before, after))
  })

  guardIt("缺陷5b：after 的 100% 档为 {} → 非 0（四个档位都必须非空）", () => {
    const { before, after } = cleanPair()
    after.census["100"] = {}
    expectFailure(runCompare(before, after))
  })

  guardIt("缺陷6b：四个档位的 lineHeight 全为 normal → 非 0（行高断言不得静默空转）", () => {
    const normal = (b) => {
      for (const k of Object.keys(b)) b[k] = { ...b[k], lineHeight: "normal" }
      return b
    }
    // 全部 lineHeight 变成不可判定（normal）→ 行高断言一次都没运行。
    // 若只是"跳过不可判定项"，这里会误报通过：字号 ×1.5、行高整类无人检查。
    const before = fileOf(normal(buildBucket()), normal(buildBucket({ fontSizeScale: 1.5 })))
    const after = fileOf(normal(buildBucket()), normal(buildBucket({ fontSizeScale: 1.5 })))
    expectFailure(runCompare(before, after))
  })

  guardIt("额外：靠「全部豁免」制造通过（连 marker 也伪造成 SVG 例外）→ 非 0", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    // 攻击：让"没有任何元素缩放"看起来仍合法。
    // 键名后缀 ::marker 保留（否则守卫 C 会先拦下），但把 isMarker 字段去掉，
    // 于是 marker 也能被归入 SVG 例外 → 三分类变成 (0 正确缩放 / 全部例外 / 0 未解释)。
    // 防线：判据 2 要求"确有元素实现缩放"，且例外不得吞没全部参与元素。
    for (const k of Object.keys(a100)) {
      const bare = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      delete bare.isMarker
      a100[k] = bare
      a150[k] = { ...bare }
    }
    expectFailure(runCompare(before, fileOf(a100, a150)))
  })

  guardIt("额外：豁免「几乎全部」元素、只缩放 1 个 → 非 0（例外必须有配额）", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    const keys = Object.keys(a100)
    // 只留最后 1 个元素真正缩放（scaled=1，满足 scaled>0），
    // 其余全部伪造成"真 SVG 例外"（svgException < participating，躲过守卫 G）。
    // 这正是基线实测的相反情形（实测 SVG 图元 0 个），防线：例外配额默认 0。
    for (const k of keys.slice(0, -1)) {
      if (k.endsWith("::marker")) continue
      a100[k] = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      a150[k] = { ...a100[k] }
    }
    expectFailure(runCompare(before, fileOf(a100, a150)))
  })

  guardIt("额外：把「未缩放的大多数」说成 SVG 例外并把配额抬到该数量 → 非 0（配额有上限）", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    // 攻击：占多数的元素被伪造成例外，然后**按需抬高配额**让守卫 I 也失效。
    // 防线：配额本身有上限（默认 0，且不得超过参与数的一个极小比例）——
    // 已登记例外只可能是零星的图标文字，不可能占多数。
    let n = 0
    for (const k of Object.keys(a100)) {
      if (k.endsWith("::marker")) continue
      a100[k] = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      a150[k] = { ...a100[k] }
      n++
    }
    expectFailure(runCompare(before, fileOf(a100, a150), ["--max-svg-exceptions", String(n)]))
  })

  /* ── 缺陷 6：判据 2 只看 fontSize，lineHeight 无覆盖 ── */

  guardIt("缺陷6：所有 fontSize ×1.5 但 lineHeight 保持 100% 原值 → 非 0", () => {
    const { before } = cleanPair()
    const after = fileOf(
      buildBucket(),
      buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1 }), // 行高未换算 = px 残留
    )
    // 该缺陷由**判据 2**（行高断言）检出，而非防线；统一由 `✗ FAIL` 受控失败行标记
    expectFailure(runCompare(before, after), "FAIL")
  })

  /* ── 缺陷 7：SVG 例外过宽 ── */

  guardIt("缺陷7：把未缩放元素全标 inSvg=true（但不带 font-size 属性标记）→ 非 0", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    for (const k of Object.keys(a100)) {
      if (!k.startsWith("changelog::") || k.endsWith("::marker")) continue
      // 未缩放（150% 档保持 100% 值）+ 只伪造 inSvg，不带 svgFontSizeAttr
      a100[k] = { ...a100[k], inSvg: true }
      a150[k] = { ...a100[k] }
    }
    // 该伪造由**判据 2**（例外判定要求 svgFontSizeAttr）检出，而非防线
    expectFailure(runCompare(before, fileOf(a100, a150)), "FAIL")
  })

  /* ── 缺陷 8：键集不一致（after 多出键 = 判据看不见的元素）── */

  guardIt("缺陷8：after 的 100%/150% 档多出一个键 → 非 0（键集必须逐一对应）", () => {
    const before = fileOf(buildBucket(), buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 }))
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    const extra = {
      fontSize: px(12), lineHeight: px(18), cls: "ghost", text: "幽灵", inSvg: false, svgFontSizeAttr: false,
    }
    a100["model::body:1>div:0>div:99"] = extra
    a150["model::body:1>div:0>div:99"] = { ...extra, fontSize: px(18), lineHeight: px(27) }
    expectFailure(runCompare(before, fileOf(a100, a150)))
  })

  /* ── 附带的参数解析缺陷 ── */

  guardIt("参数：--scales 100,abc（含非数字 token，compare 模式）→ 非 0", () => {
    const { before, after } = cleanPair()
    expectFailure(runCompare(before, after, ["--scales", "100,abc"]), "ARG-FAIL")
  })

  guardIt("参数：--scales 100,abc（采集模式）→ 非 0，且不得产生输出文件（解析必须在启动浏览器前失败）", () => {
    const out = join(TMP_ROOT, `should-not-exist-${seq++}.json`)
    const res = runTool(["--scales", "100,abc", "--out", out])
    expectFailure(res, "ARG-FAIL")
    expect(existsSync(out), "参数非法时不得进入采集、不得写出 census 文件").toBe(false)
  })

  guardIt("参数：--scales 后面紧跟另一个 flag（--out）→ 非 0 且给出清晰错误", () => {
    const res = runTool(["--scales", "--out", join(TMP_ROOT, `nope-${seq++}.json`)])
    expectFailure(res, "ARG-FAIL")
  })
})

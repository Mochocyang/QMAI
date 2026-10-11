/**
 * 对抗测试：能否绕过「SVG 例外配额」把「全都没缩放」伪装成通过。
 *
 * 为什么要独立于 census-guards.spec.mjs 再写一份：
 *   代理自己写的守卫用例，与它自己的实现出自同一思路；
 *   若要发现「守卫本身有漏洞」，必须用**独立的攻击视角**重写一遍。
 *   本脚本只做攻击，不复用对方的 fixture 生成器。
 *
 * 攻击面（配额机制是新增的，故重点打它）：
 *   1. 把全部元素伪装成 SVG 图标文字，并把配额设成巨大 → 是否放行？
 *   2. 豁免「几乎全部」元素，只让 1 个真缩放，配额给一个看似合理的数 → 是否放行？
 *   3. 不传配额时，真 SVG 例外（1 个）是否也被要求显式声明？
 *
 * 注意（如实登记）：census JSON 是外部输入，工具无法鉴别其真伪。
 *   本测试针对的是**配额配置被滥用**，不是伪造数据 ——
 *   「一份被手工伪造得自洽的 JSON 仍能骗过任何比较器」这一点工具已明示免责。
 */
import { spawnSync } from "node:child_process"
import { writeFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const SECTIONS = [
  "model", "novel", "network", "web-search", "interface", "user-memory",
  "maintenance", "data-management", "feedback", "contact-support", "changelog",
]
const px = (n) => `${Number(n.toFixed(4))}px`

function bucket({ scale = 1, svg = false, keysPerSection = 3 } = {}) {
  const out = {}
  for (const sec of SECTIONS) {
    for (let i = 0; i < keysPerSection; i++) {
      const base = 12 + 2 * i
      out[`${sec}::body:1>div:0>div:${i}`] = {
        fontSize: px(base * scale), lineHeight: px(base * 1.5 * scale),
        cls: `probe-${sec}-${i}`, text: `探针${i}`,
        inSvg: svg, svgFontSizeAttr: svg,
      }
    }
    // ::marker 必须存在（防线 C 要求四个档位 marker 条数 > 0）
    out[`${sec}::body:1>div:0>ul:0>li:0::marker`] = {
      fontSize: px(14 * scale), lineHeight: px(21 * scale),
      cls: "flex gap-2", text: "标记条目", inSvg: false, svgFontSizeAttr: false,
    }
  }
  return out
}

const dir = mkdtempSync(join(tmpdir(), "adv-quota-"))
const file = (name, o) => {
  const p = join(dir, `${name}.json`)
  writeFileSync(p, JSON.stringify(o), "utf8")
  return p
}

const TOOL = "docs/font-scaling-fix-20261007/census-computed-font.mjs"
function run(args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", timeout: 120000 })
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}
function reason(out) {
  const line = out.split("\n").find((l) => /GUARD-FAIL|ARG-FAIL|FAIL/.test(l))
  return (line ?? "").trim().slice(0, 160)
}
function summary(out) {
  return out.split("\n").filter((l) => /正确缩放|SVG 例外|未解释|判据 2/.test(l)).map((l) => l.trim()).join(" | ")
}

// 基准的 before：100% 与 150% 都正常（150% 全部 ×1.5）
const before = file("before", { census: { 100: bucket(), 150: bucket({ scale: 1.5 }) } })

console.log("  ══ 对抗测试：SVG 例外配额能否被绕过 ══\n")

/* ── 攻击 1：全部伪装成 SVG 图标文字 + 巨大配额 ── */
const afterAllSvg = file("after-all-svg", { census: { 100: bucket({ svg: true }), 150: bucket({ svg: true }) } })
const r1 = run(["--compare", before, afterAllSvg, "--max-svg-exceptions", "9999"])
console.log(`  攻击1  全部伪装 SVG + 配额 9999  → 退出 ${r1.code}  ${r1.code === 0 ? "⚠️ 放行了" : "✓ 被拒"}`)
console.log(`         ${r1.code === 0 ? summary(r1.out) : reason(r1.out)}`)

/* ── 攻击 2：值**完全不缩放**，但把非 marker 元素全部伪装成 SVG 图标文字，
        再给一个大配额 —— 这才是"用配额掩盖真实缺陷"的攻击 ──
   注意：marker 条目不参与伪装（防线 C 要求 marker 存在，且 marker 不可能在 SVG 里）。
   上一版此处构造有误（把 150% 档也设成了 ×1.5，即值真的缩放了），
   于是"通过"是正确行为而非漏洞；现修正为 150% 档保持原值（不缩放）。 */
const a100Most = bucket({ svg: true })
let firstKey = null
for (const k of Object.keys(a100Most)) {
  if (k.endsWith("::marker")) continue
  if (firstKey === null) { firstKey = k; a100Most[k].inSvg = false; a100Most[k].svgFontSizeAttr = false }
}
// 150% 档：数值与 100% 完全相同（未缩放），并把非 marker 全部标为 SVG 例外
const a150Most = bucket()
for (const k of Object.keys(a150Most)) {
  if (k.endsWith("::marker")) continue
  a150Most[k].inSvg = true
  a150Most[k].svgFontSizeAttr = true
}
const afterMostSvg = file("after-most-svg", { census: { 100: a100Most, 150: a150Most } })
console.log(`  （修正后的攻击2：150% 档数值与 100% 完全相同 = 44 个元素一个都没缩放，\n` +
  `    其中 33 个被伪称 SVG 例外、11 个 marker 无法伪装）`)
for (const q of ["0", "40", "100", "1000"]) {
  const r = run(["--compare", before, afterMostSvg, "--max-svg-exceptions", q])
  console.log(`  攻击2  全部不缩放+伪装 + 配额 ${q.padStart(4)}  → 退出 ${r.code}  ${r.code === 0 ? "⚠️ 放行了" : "✓ 被拒"}`)
  console.log(`         ${r.code === 0 ? summary(r.out) : reason(r.out)}`)
}
// 只伪装一部分（留够 marker 之外的真缩放着），看配额与"真缩放"如何互动
const partA100 = bucket()
const partA150 = bucket({ scale: 1.5 })
let masked = 0
for (const k of Object.keys(partA150)) {
  if (k.endsWith("::marker")) continue
  if (masked++ >= 20) break
  partA150[k].fontSize = partA100[k].fontSize   // 这 20 个不缩放
  partA150[k].lineHeight = partA100[k].lineHeight
  partA100[k].inSvg = true
  partA100[k].svgFontSizeAttr = true
}
const afterPartial = file("after-partial-mask", { census: { 100: partA100, 150: partA150 } })
for (const q of ["19", "20"]) {
  const r = run(["--compare", before, afterPartial, "--max-svg-exceptions", q])
  console.log(`  攻击2b 掩盖 20 个真未缩放 + 配额 ${q.padStart(3)}  → 退出 ${r.code}  ${r.code === 0 ? "⚠️ 放行了" : "✓ 被拒"}`)
  console.log(`         ${r.code === 0 ? summary(r.out) : reason(r.out)}`)
}

/* ── 攻击 3：单个真 SVG 例外，配额给 0 / 给 1 ── */
const t100 = bucket()
const t150 = bucket({ scale: 1.5 })
const target = "changelog::body:1>div:0>div:0"
t100[target].inSvg = true
t100[target].svgFontSizeAttr = true
t150[target].inSvg = true
t150[target].svgFontSizeAttr = true
t150[target].fontSize = t100[target].fontSize
t150[target].lineHeight = t100[target].lineHeight
const afterOneSvg = file("after-one-svg", { census: { 100: t100, 150: t150 } })

const r3 = run(["--compare", before, afterOneSvg])
console.log(`  攻击3  1 个真例外 + 配额默认 0  → 退出 ${r3.code}  ${r3.code === 0 ? "放行了" : "✓ 被拒（例外须显式声明）"}`)
console.log(`         ${r3.code === 0 ? summary(r3.out) : reason(r3.out)}`)

const r4 = run(["--compare", before, afterOneSvg, "--max-svg-exceptions", "1"])
console.log(`  攻击3b 1 个真例外 + 配额 1      → 退出 ${r4.code}  ${r4.code === 0 ? "✓ 放行（显式声明后可接受）" : "被拒"}`)
console.log(`         ${r4.code === 0 ? summary(r4.out) : reason(r4.out)}`)

/* ── 攻击 4：把配额设成非数字 / 负数，看是否被当成"不限制" ── */
for (const q of ["abc", "-1", "0.5"]) {
  const r = run(["--compare", before, afterOneSvg, "--max-svg-exceptions", q])
  console.log(`  攻击4  配额 ${q.padStart(4)}            → 退出 ${r.code}  ${r.code === 0 ? "⚠️ 放行了" : "✓ 被拒"}`)
  console.log(`         ${r.code === 0 ? summary(r.out) : reason(r.out)}`)
}

/* ── 攻击 5（最强）：把 marker 也正确缩放（marker 绝不可能在 SVG 里，
        故它不可能被伪装成例外），其余元素全部不缩放并伪称 SVG 例外，
        再给足够大的配额 —— 这绕开了"marker 当哨兵"的结构性保护 ── */
const strongest100 = bucket()
const strongest150 = bucket({ scale: 1.5 })   // marker 正确缩放，保持哨兵通过
for (const k of Object.keys(strongest150)) {
  if (k.endsWith("::marker")) continue
  strongest150[k].fontSize = strongest100[k].fontSize     // 非 marker 一律不缩放
  strongest150[k].lineHeight = strongest100[k].lineHeight
  strongest100[k].inSvg = true                             // 且全部伪称 SVG 例外
  strongest100[k].svgFontSizeAttr = true
}
const afterStrongest = file("after-strongest", { census: { 100: strongest100, 150: strongest150 } })
const nonMarker = Object.keys(strongest100).filter((k) => !k.endsWith("::marker")).length
for (const q of ["0", String(nonMarker)]) {
  const r = run(["--compare", before, afterStrongest, "--max-svg-exceptions", q])
  console.log(`  攻击5  仅 marker 缩放+其余全伪装(${nonMarker} 个) + 配额 ${q.padStart(2)}  → 退出 ${r.code}  ${r.code === 0 ? "⚠️ 放行了" : "✓ 被拒"}`)
  console.log(`         ${r.code === 0 ? summary(r.out) : reason(r.out)}`)
}

console.log(`
  ── 结论：配额机制的有效边界（实测，非推断）──
    配额上限公式（工具内 svgExceptionCap）：max(5, floor(参与元素 × 3%))
      · 本机可达页面实测参与元素 1113 → 上限 33。实测：配额 33 通过配额检查、
        配额 34 被拒（✗ GUARD-FAIL [I0/配额越界]）。
      · 小样本下退化为绝对值 5（本脚本 44 元素的 fixture 上即如此）。

    能挡住：
      · 默认配额 0 时的任何例外（默认即最严）；
      · 配额低于例外数；
      · 配额超过上限（> 3%，或小样本 > 5）；
      · 非数字 / 负数 / 小数配额（✗ ARG-FAIL，且在启动浏览器前就失败）；
      · 把 marker 之外全部伪装的粗糙攻击（marker 不可能在 SVG 里，会留下哨兵）。

    挡不住（不可回避，已如实登记在工具头部）：
      操作者**显式声明**一个不超过上限的配额，且 JSON 里这些例外看起来与
      真实 SVG 图标文字无异 —— 本工具无法鉴别外部 census JSON 的真伪。
      即：最多可把 33/1113（3%）个未缩放元素伪装成图标文字。

    为何仍可接受：
      (1) 这与最初那 7 条缺陷性质**根本不同**：那 7 条是**静默**通过，
          无需任何人做任何反常操作；本条必须主动、可见地键入一个配额，
          且工具会把"SVG 例外 N / 配额 N"打印出来；
      (2) 本机实测 SVG 例外 = 0，默认配额 = 0 —— 任何 >0 的配额都是偏离；
      (3) 3% 上限使"把未缩放的大多数说成在图标里"在结构上不可能；
      (4) 因此收尾时始终以**默认配额 0** 运行：此时任何例外都会失败，
          把"例外到底是不是真的"强制抛给真人判断。

  ── 本脚本的独立性声明 ──
    本脚本不复用 census-guards.spec.mjs 的 fixture 生成器，攻击视角独立重写。
    理由：自己写的守卫用例与自己的实现出自同一思路；
    要发现"守卫本身的漏洞"，必须用独立的攻击视角再打一遍。
    第一版攻击2 曾因构造错误（把 150% 档也设成 ×1.5，即值真的缩放了）
    得到"放行"的假警报 —— 说明**攻击脚本本身也会错**，
    遇到"通过"时必须先复核攻击构造，而不是直接下结论。`)



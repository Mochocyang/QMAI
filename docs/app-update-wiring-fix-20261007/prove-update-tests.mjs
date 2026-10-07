/**
 * 证明更新检查相关测试不是空话。
 *
 * 六个变异，各自独立执行、逐条还原、SHA256 校验：
 *
 *  M1 再删掉 runAppUpdateFlow 的 export      → app-updater.test.ts 必须变红
 *     （这正是 01aab5f 干的事，也是功能死掉却没人发现的原因）
 *  M2 从 App.tsx 删掉 void checkForAppUpdate() → 接线测试 1、2 必须变红
 *     （这正是 26f80ee 干的事，就是用户报告的故障）
 *  M3 把调用套进 if (!IS_UI_TEST_BUILD)        → 接线测试 3 必须变红
 *     （恒假守卫：写了等于没写，tsc 与其它测试都不报错）
 *  M4 去掉 checkForAppUpdate 里的 !isTauri()   → 入口测试"非 Tauri 不检查"必须变红
 *  M5 让 checkForAppUpdate 不转发给 runAppUpdateFlow → 入口测试必须变红
 *
 * M2 单独通过不代表防线有效：M3 证明"看起来调用了但恒不执行"也能被抓住。
 *
 * 刻意没有 M"去掉 updateCheckStarted 并发守卫"：那个守卫**没有测试覆盖**，
 * 因为并发动态 import 被 mock 的模块在本仓库的 vitest 下不可靠（实测其中一次
 * 会拿到真实模块），导致任何此类用例都恒真。详见 app-updater-check.test.ts
 * 结尾的说明。把这条放进变异清单，只会制造"已验证"的假象。
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")

const APP = resolve(root, "src/App.tsx")
const UPDATER = resolve(root, "src/lib/app-updater.ts")

const EXCLUDES = [
  "--exclude", "**/.claude/**",
  "--exclude", "**/.codex-temp/**",
  "--exclude", "**/superpowers/**",
]

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")

function runTests() {
  try {
    const out = execFileSync(
      "npx.cmd",
      ["vitest", "run",
        "src/lib/app-updater.test.ts",
        "src/lib/app-updater-check.test.ts",
        "src/lib/app-updater-wiring.test.ts",
        ...EXCLUDES],
      { cwd: root, stdio: "pipe", shell: true, encoding: "utf8" },
    )
    // 成功时也要带上输出，否则基线那行的用例数取不到（第一版就是这样）
    return { green: true, out: out ?? "" }
  } catch (err) {
    return { green: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` }
  }
}

/** 文件可能是 CRLF 也可能是 LF；两种都试，避免"锚点未找到"的假阴性。 */
function applyReplace(text, from, to) {
  if (text.includes(from)) return text.replace(from, to)
  const crlfFrom = from.replace(/\n/g, "\r\n")
  const crlfTo = to.replace(/\n/g, "\r\n")
  if (text.includes(crlfFrom)) return text.replace(crlfFrom, crlfTo)
  return null
}

const mutations = [
  {
    name: "M1 再删掉 runAppUpdateFlow 的 export",
    file: UPDATER,
    from: "export async function runAppUpdateFlow(bindings: UpdaterBindings) {",
    to: "async function runAppUpdateFlow(bindings: UpdaterBindings) {",
    expectRed: /app-updater\.test\.ts/,
  },
  {
    name: "M2 从 App.tsx 删掉调用",
    file: APP,
    from: "        void checkForAppUpdate()\n",
    to: "",
    expectRed: /app-updater-wiring\.test\.ts/,
  },
  {
    name: "M3 把调用套进恒假的 if (!IS_UI_TEST_BUILD)",
    file: APP,
    from: "        void checkForAppUpdate()",
    to: "        if (!IS_UI_TEST_BUILD) { void checkForAppUpdate() }",
    expectRed: /app-updater-wiring\.test\.ts/,
  },
  {
    name: "M4 去掉入口的 !isTauri() 守卫",
    file: UPDATER,
    from: "if (!isTauri() || !isAppAutoUpdateSupported() || updateCheckStarted) return",
    to: "if (!isAppAutoUpdateSupported() || updateCheckStarted) return",
    expectRed: /app-updater-check\.test\.ts/,
  },
  {
    name: "M5 入口不转发给 runAppUpdateFlow",
    file: UPDATER,
    from: `    await runAppUpdateFlow({
      isTauri: true,
      check,
      confirm,
      message,
    })`,
    to: "    void check; void confirm; void message",
    expectRed: /app-updater-check\.test\.ts/,
  },
]

const results = []
let red = 0
let restoreFailures = 0

for (const m of mutations) {
  const before = sha(m.file)
  const original = readFileSync(m.file, "utf8")
  const mutated = applyReplace(original, m.from, m.to)

  if (mutated === null) {
    results.push(`  ?? ${m.name} —— 锚点未找到，变异没落地`)
    continue
  }

  try {
    writeFileSync(m.file, mutated, "utf8")
    const r = runTests()
    const hitTarget = m.expectRed.test(r.out)
    if (!r.green && hitTarget) {
      results.push(`  变红 ${m.name}`)
      red += 1
    } else {
      results.push(
        `  未如期变红 ← 测试有漏洞! ${m.name}`
          + `（退出红=${!r.green}，命中预期文件=${hitTarget}）`,
      )
    }
  } finally {
    writeFileSync(m.file, original, "utf8")
    if (sha(m.file) !== before) {
      restoreFailures += 1
      results.push(`  !! 还原失败: ${m.name}`)
    }
  }
}

console.log(results.join("\n"))

const baseline = runTests()
// 不硬编码用例数：删掉假绿的并发用例后数量变过，写死的数字会变成假报告。
const baselineCount = /Tests\s+(\d+) passed/.exec(baseline.out)?.[1]
console.log(
  `\n还原后基线：${baseline.green ? `${baselineCount ?? "?"} 个用例全绿` : "仍红 ← 还原不干净"}`,
)
console.log(`变异 ${mutations.length} 项，如期变红 ${red} 项`)

if (red !== mutations.length || restoreFailures > 0 || !baseline.green) process.exitCode = 1

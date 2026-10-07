/**
 * 发版前版本面一致性检查：确认每一处版本号都恰好是目标版本。
 *
 * 为什么不能只看 package.json：发版面有 7 处（其中 Cargo.lock 里同名 crate
 * 有 3 处 4.1.0，只有 qmai 那一处该改）。漏改一处，产物里的版本号就会
 * 与实际发布版本不一致 —— 而 GitHub 的 Release 与安装包文件名都取 version，
 * 很容易到用户装完才发现。
 *
 * 用法: node docs/release-4.1.1-20261007/check-version-surface.mjs 4.1.1
 */
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")
const target = process.argv[2] ?? "4.1.1"
const previous = process.argv[3] ?? "4.1.0"

const read = (rel) => readFileSync(resolve(root, rel), "utf8")
const problems = []
const ok = []

function expectExact(label, actual, expected) {
  if (actual === expected) ok.push(`${label} = ${actual}`)
  else problems.push(`${label} = ${actual}（期望 ${expected}）`)
}

// 1. package.json
expectExact("package.json version", JSON.parse(read("package.json")).version, target)

// 2. package-lock.json —— 两处：根 version 与 packages[""].version
const lock = JSON.parse(read("package-lock.json"))
expectExact("package-lock.json version", lock.version, target)
expectExact('package-lock.json packages[""].version', lock.packages[""].version, target)

// 3. src-tauri/Cargo.toml —— [package] 段里的 version
const cargoToml = read("src-tauri/Cargo.toml")
const cargoPkgVersion = /\[package\][\s\S]*?^version = "([^"]+)"/m.exec(cargoToml)?.[1]
expectExact("Cargo.toml [package].version", cargoPkgVersion, target)

// 4. src-tauri/Cargo.lock —— 只看 name = "qmai" 那一处
const cargoLock = read("src-tauri/Cargo.lock").replace(/\r\n/g, "\n")
const qmaiBlock = /\[\[package\]\]\nname = "qmai"\nversion = "([^"]+)"/.exec(cargoLock)
expectExact('Cargo.lock [[package]] name="qmai".version', qmaiBlock?.[1] ?? "(未找到)", target)

// 5. src-tauri/tauri.conf.json
expectExact("tauri.conf.json version", JSON.parse(read("src-tauri/tauri.conf.json")).version, target)

// 6. changelog.ts —— 条目 version + 日期 + 三个接线点
const changelog = read("src/lib/changelog.ts").replace(/\r\n/g, "\n")
if (!new RegExp(`version: "${target.replace(/\./g, "\\.")}"`).test(changelog)) {
  problems.push(`changelog.ts 里没有 version: "${target}" 的条目`)
} else ok.push(`changelog.ts 条目 version = ${target}`)
if (!/if \(version === FOUR_POINT_ONE_ONE_CHANGELOG\.version\)/.test(changelog)) {
  problems.push("changelog.ts currentVersionChangelog 缺少 4.1.1 分支")
} else ok.push("changelog.ts currentVersionChangelog 分支存在")
if (!/return \[\s*\n\s*FOUR_POINT_ONE_ONE_CHANGELOG,/.test(changelog)) {
  problems.push("changelog.ts allChangelog 首位不是 4.1.1")
} else ok.push("changelog.ts allChangelog 首位是 4.1.1")

// 7. changelog.spec.ts —— 首位断言已更新
const spec = read("src/lib/changelog.spec.ts")
if (!spec.includes(`"${target}"`)) {
  problems.push(`changelog.spec.ts 未引用 ${target}`)
} else ok.push(`changelog.spec.ts 引用 ${target}`)
if (spec.includes(`versions.slice(0, 4)).toEqual(["${previous}"`)) {
  problems.push(`changelog.spec.ts 首位断言仍是 ${previous}`)
} else ok.push("changelog.spec.ts 首位断言已更新")

// 8. 反过来确认没有漏网的旧版本号出现在"应当已改"的位置
const staleHits = []
for (const rel of [
  "package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
]) {
  const text = read(rel).replace(/\r\n/g, "\n")
  if (text.includes(`"${previous}"`) || text.includes(`= "${previous}"`)) {
    staleHits.push(rel)
  }
}
if (staleHits.length) problems.push(`仍残留 ${previous}：${staleHits.join(", ")}`)
else ok.push(`package.json / Cargo.toml / tauri.conf.json 无残留 ${previous}`)

// 9. git 层面：只应改动这 7 个文件
const changed = execFileSync("git", ["diff", "--name-only"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
const allowed = new Set([
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "src/lib/changelog.ts",
  "src/lib/changelog.spec.ts",
])
const unexpected = changed.filter((f) => !allowed.has(f))
if (unexpected.length) problems.push(`出现了预期外的改动：${unexpected.join(", ")}`)
else ok.push(`改动文件均属发版面（${changed.length} 个）`)

console.log(ok.map((line) => `  OK   ${line}`).join("\n"))
if (problems.length) {
  console.log(`\n问题 ${problems.length} 处：`)
  for (const p of problems) console.log(`  FAIL ${p}`)
  process.exitCode = 1
} else {
  console.log(`\n版本面一致：${ok.length} 项全过，目标 ${target}（上一版 ${previous}）`)
}

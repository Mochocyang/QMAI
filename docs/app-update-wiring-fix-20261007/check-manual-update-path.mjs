/**
 * 逐版核实：受影响的 v4.0.0–v4.1.1 里，设置页的"手动检查更新"入口是否存在。
 *
 * 为什么要查这个：自动检查因 26f80ee 被删而失效，但如果手动入口也在，
 * 用户就不算被卡死 —— 这直接决定了对外说明该怎么写。
 * 反过来，如果手动入口是后来才加的，早期版本的用户就只能去 GitHub 手动下载。
 *
 * 用脚本而非 PowerShell 内联：`git show <tag>:<path>` 里的冒号与路径
 * 经 cmd/PowerShell 两层会被拆错（实测报 "too many arguments"）。
 */
import { execFileSync } from "node:child_process"

const TAGS = ["v4.0.0", "v4.0.1", "v4.0.2", "v4.0.3", "v4.0.4", "v4.1.0", "v4.1.1"]
const PATH = "src/components/settings/sections/changelog-section.tsx"

/*
 * 手动入口的判据。
 *
 * 第一版要求必须出现 `checkForChangelogUpdate`，结果把 v4.0.0/v4.0.1 误判为
 * "没有手动入口" —— 实际那两版用的是本文件内的 `handleCheckUpdate()`，
 * 内部同样 `await check()`，入口完全可用。该函数是在 v4.0.2 才被抽到
 * changelog-update-session.ts 并改名的。
 *
 * 教训同"拆书库 chunk 锚点"：锚点必须是**能力**，不能是某个具体标识符，
 * 否则一次重构就会让检查给出反向结论。
 */
const BUTTON = { key: "按钮「检查更新」", any: ["检查更新"] }

/** 触发方式：抽出的会话函数，或本文件内直接调用 updater 插件，二者皆可。 */
const TRIGGER = {
  key: "更新检查触发（会话函数或直接调用插件）",
  any: ["checkForChangelogUpdate", "@tauri-apps/plugin-updater", "handleCheckUpdate"],
}

const NEEDLES = [BUTTON, TRIGGER]

function showFile(tag, path) {
  try {
    return { ok: true, text: execFileSync("git", ["show", `${tag}:${path}`], { encoding: "utf8" }) }
  } catch (err) {
    return { ok: false, err: String(err.stderr ?? err.message).trim().split("\n")[0] }
  }
}

console.log("版本      手动检查更新入口")
console.log("─".repeat(58))

let allHave = true
for (const tag of TAGS) {
  const r = showFile(tag, PATH)
  if (!r.ok) {
    console.log(`${tag.padEnd(9)} 文件不存在 —— 只能去 GitHub 手动下载  (${r.err})`)
    allHave = false
    continue
  }
  const missing = NEEDLES.filter((n) => !n.any.some((t) => r.text.includes(t)))
  if (missing.length === 0) {
    // 记录用的是哪种触发方式，便于复核判据是否命中真实实现
    const how = TRIGGER.any.filter((t) => r.text.includes(t))
    console.log(`${tag.padEnd(9)} 有（触发方式：${how.join(" / ")}）`)
  } else {
    console.log(`${tag.padEnd(9)} 缺：${missing.map((m) => m.key).join("、")}`)
    allHave = false
  }
}

console.log()
if (allHave) {
  console.log("结论：受影响区间内每一版都有可用的手动检查更新入口 ——")
  console.log("      用户升级一次即可恢复自动更新，不必手动下载安装包。")
} else {
  console.log("结论：存在没有手动入口的版本，那部分用户只能去 GitHub 手动下载。")
}

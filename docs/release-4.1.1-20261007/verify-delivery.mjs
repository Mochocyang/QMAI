/**
 * 发版交付核验：远端 main 与解引用后的标签是否都指向 release commit，
 * 以及 QMAI Multi-Platform Release 是否为该 tag + 该 SHA 启动。
 *
 * 用脚本而非 PowerShell 内联：`gh --jq` 与 `git ls-remote` 的参数里
 * 含花括号、尖括号、引号，经 cmd/PowerShell 两层会被拆错
 * （实测报 "accepts at most 1 arg(s), received 2"）。
 */
import { execFileSync } from "node:child_process"

const RECORDED = process.argv[2] ?? "bd8f2cb169d70f9ff0885486d794a0b10669285f"
const TAG = process.argv[3] ?? "v4.1.1"

const run = (cmd, args, opts = {}) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", ...opts }).trim() }
  } catch (err) {
    return { ok: false, out: (err.stdout ?? "").trim(), err: (err.stderr ?? err.message ?? "").trim() }
  }
}

/** schannel 握手在这个环境里时好时坏，重试几次。 */
function runRetry(cmd, args, tries = 6) {
  let last
  for (let i = 1; i <= tries; i += 1) {
    last = run(cmd, args)
    if (last.ok) return last
    execFileSync(process.execPath, ["-e", "setTimeout(()=>{},1)"]) // 无明显副作用的小停顿
  }
  return last
}

console.log("=== 1) 远端引用 ===")
/*
 * 注意：带 pattern 的 `git ls-remote --tags origin v4.1.1` **不会**返回
 * `refs/tags/v4.1.1^{}` 这一行（pattern 匹配不到剥离引用的后缀），
 * 于是"找不到解引用结果"会被误读成"这不是 annotated tag"。
 * 改为列出全部标签后在本地筛选。
 */
const ls = runRetry("git", ["ls-remote", "--tags", "origin"])
const lsMain = runRetry("git", ["ls-remote", "origin", "main"])
if (!ls.ok || !lsMain.ok) {
  console.log(`  网络仍失败：${ls.err || lsMain.err}`)
  process.exitCode = 1
} else {
  console.log(lsMain.out.split("\n").map((l) => `  ${l}`).join("\n"))
  const tagLines = ls.out.split("\n").filter((l) => l.includes(`refs/tags/${TAG}`))
  console.log(tagLines.map((l) => `  ${l}`).join("\n"))

  const peeled = tagLines.find((l) => l.endsWith(`${TAG}^{}`))
  const direct = tagLines.find((l) => l.endsWith(`refs/tags/${TAG}`))
  const peeledSha = peeled ? peeled.split(/\s+/)[0] : ""
  const directSha = direct ? direct.split(/\s+/)[0] : ""
  const mainSha = lsMain.out.split(/\s+/)[0]

  const problems = []
  /*
   * 两个不变量要分开看：
   *  - 打标签那一刻：main 必须**恰好等于** release commit（脚本原本只查这个）。
   *  - 发版之后：main 可以合法前进（后续修复提交），但 release commit
   *    必须仍是 main 的祖先；标签永远不许移动。
   * 只查"恰好等于"会在任何后续提交之后误报 —— 而它看起来跟真问题一模一样。
   */
  const mainIsRecorded = mainSha === RECORDED
  let mainAhead = false
  if (!mainIsRecorded) {
    const anc = run("git", ["merge-base", "--is-ancestor", RECORDED, mainSha])
    mainAhead = anc.ok
  }
  if (!mainIsRecorded && !mainAhead) {
    problems.push(`远端 main = ${mainSha}，既不是 ${RECORDED} 也不是它的后继`)
  }
  if (!direct) problems.push(`远端没有 ${TAG}`)
  if (!peeled) {
    problems.push(`远端 ${TAG} 没有剥离引用 —— 说明它是轻量标签而非 annotated tag`)
  } else if (peeledSha !== RECORDED) {
    problems.push(`解引用标签 = ${peeledSha}，应为 ${RECORDED}（标签被移动了？）`)
  }
  // annotated tag：对象 SHA 与它指向的 commit SHA 必然不同
  if (direct && peeled && directSha === peeledSha) {
    problems.push(`${TAG} 的对象 SHA 与 commit SHA 相同 —— 不是 annotated tag`)
  }

  if (problems.length) {
    console.log(`\n  问题：`)
    for (const p of problems) console.log(`    FAIL ${p}`)
    process.exitCode = 1
  } else {
    console.log(`\n  OK annotated tag ${TAG}（对象 ${directSha.slice(0, 10)}）`)
    console.log(`     解引用后指向 commit ${peeledSha} —— 标签正确且未移动`)
    console.log(
      mainIsRecorded
        ? `     远端 main 恰为 release commit`
        : `     远端 main 已前进到 ${mainSha.slice(0, 10)}（release commit 仍是其祖先，属正常后续提交）`,
    )
  }
}

console.log("\n=== 2) 打包工作流 ===")
const runs = run("gh", [
  "run", "list", "-R", "Mochocyang/QMAI", "--workflow=build.yml",
  "--limit", "3", "--json", "databaseId,headBranch,headSha,status,conclusion,createdAt",
])
if (!runs.ok) {
  console.log(`  查询失败：${runs.err}`)
  process.exitCode = 1
} else {
  for (const r of JSON.parse(runs.out)) {
    console.log(`  ${r.status.padEnd(12)} ${String(r.conclusion ?? "-").padEnd(9)} ${r.headBranch.padEnd(8)} ${r.headSha.slice(0, 10)}  run ${r.databaseId}`)
  }
  const mine = JSON.parse(runs.out).find((r) => r.headBranch === TAG)
  if (!mine) {
    console.log(`\n  FAIL 没有找到 tag=${TAG} 的运行`)
    process.exitCode = 1
  } else if (mine.headSha !== RECORDED) {
    console.log(`\n  FAIL run 的 headSha = ${mine.headSha}，应为 ${RECORDED}`)
    process.exitCode = 1
  } else {
    console.log(`\n  OK run ${mine.databaseId} 为该 tag 与 SHA 启动，状态 ${mine.status}`)
  }
}

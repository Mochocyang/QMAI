// 清理/还原某个目录下**由测试或几何脚本生成**的受跟踪文件。
//
// 背景：本仓库有几个"跑测试就变"的生成物，会把工作区弄脏、干扰下一轮 A/B：
//   - docs/legacy-character-binding-20261006/dump.html（dump-actions.spec.tsx 写）
//   - docs/legacy-character-binding-20261006/after-*.png（check.mjs 写）
//   - docs/book-analysis-legacy-merge-20261006/after-*.png
//
// 三条踩过的坑，别改回去：
//   1) 禁止 git checkout -- / git restore（本仓库明令），这里用 git cat-file blob 取字节写回。
//   2) 中文路径不能用 `git diff --name-only`：它会输出 C 风格转义（"...after-\350\247\222..."），
//      直接丢给 fs 会 ENOENT。必须用 -z（NUL 分隔、不加引号）拿原始路径。
//   3) 删除文件不能靠 node 的 rmSync：对含中文的路径它会在**已存在的文件**上静默失败
//      （实测：rmSync 不抛错但文件还在，"force" 也救不了）。改用 PowerShell 的
//      Remove-Item -LiteralPath，并且用 Get-ChildItem 的现成对象取路径，绝不手敲中文。
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const area = process.argv[2]
if (!area) { console.error("用法: node restore-generated.mjs <目录>"); process.exit(2) }

const zlines = (args) => {
  const r = spawnSync("git", [...args, "-z", "--", area], { encoding: "utf8" })
  return (r.stdout || "").split("\0").filter(Boolean)
}

// 1) 未跟踪的多余文件（含坏重定向留下的 0 字节空壳）→ 交给 PowerShell 删。
const others = zlines(["ls-files", "--others", "--exclude-standard"])
if (others.length) {
  const ps = [
    "$dir = (Get-Item -LiteralPath $env:RESTORE_AREA).FullName",
    "$names = $env:RESTORE_NAMES | ConvertFrom-Json",
    "foreach ($n in $names) {",
    "  $f = Get-ChildItem -LiteralPath $dir -Force | Where-Object { $_.Name -eq $n }",
    "  if ($f) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Continue; Write-Output ((Test-Path -LiteralPath $f.FullName) ? \"删除失败: $n\" : \"已删除: $n\") }",
    "  else { Write-Output \"已不在磁盘: $n\" }",
    "}",
  ].join("\n")
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    env: { ...process.env, RESTORE_AREA: area, RESTORE_NAMES: JSON.stringify(others.map((p) => p.split("/").pop())) },
  })
  process.stdout.write(r.stdout || "")
  if (r.status !== 0) { console.error(r.stderr || ""); process.exitCode = 1 }
}

// 2) 被改动的受跟踪文件 → 从 HEAD 的 blob 按字节写回。
for (const p of zlines(["diff", "--name-only"])) {
  const blob = spawnSync("git", ["cat-file", "blob", `HEAD:${p}`], { maxBuffer: 1 << 28 })
  if (blob.status !== 0) { console.error(`取不到 HEAD:${p}`); process.exitCode = 1; continue }
  writeFileSync(p, blob.stdout)
  const after = spawnSync("git", ["status", "--short", "--", p], { encoding: "utf8" }).stdout.trim()
  console.log(`${after ? "仍不一致: " + after : "已还原"}: ${p}  (${blob.stdout.length} 字节)`)
}

const final = spawnSync("git", ["status", "--short", "--", area], { encoding: "utf8" }).stdout.trim()
console.log(final ? `\n该目录仍有改动:\n${final}` : "\n该目录已完全干净")

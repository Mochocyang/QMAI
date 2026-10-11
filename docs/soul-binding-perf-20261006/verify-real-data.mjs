/**
 * 真实项目数据的过滤规则校验 —— 现在由一条真正的回归测试承担：
 *   src/lib/novel/bindable-characters-real-data.spec.ts
 *
 * 早期版本是「用正则从源码里抠出词表、再在脚本里重写一遍 isJunk」，
 * 那是个镜像而不是测试：规则改了它照样通过（审查者的 F5）。
 * 现在直接调用发布出去的 filterBindableCharacters / isLikelyNonCharacterName，
 * 所以这里只负责把它跑起来，不再自己实现一遍判断逻辑。
 *
 * 运行：node docs/soul-binding-perf-20261006/verify-real-data.mjs
 */
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

// Windows 上 .cmd 必须走 shell 才能被 spawn（否则 EINVAL 且静默无输出）。
const result = spawnSync(
  "npx vitest run src/lib/novel/bindable-characters-real-data.spec.ts "
    + '--exclude "**/.codex-temp/**" --exclude "**/.claude/**" --exclude "**/.worktrees/**"',
  { cwd: repo, stdio: "inherit", shell: true },
)

if (result.error) {
  console.error("运行失败：", result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)

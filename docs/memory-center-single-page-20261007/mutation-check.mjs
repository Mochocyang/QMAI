/**
 * 变异校验：把记忆中心单页重构的每条新断言逐个"反向"改回去，
 * 确认对应的测试确实会变红。断言绿而变异不红 = 断言是空的。
 *
 * 为什么必须做：本项目刚在便携版校验里踩过这个坑 —— 断言写得很像回事，
 * 其实被自己写的注释或相邻规则喂饱，无论代码对错都是绿的。
 *
 * 用法: node docs/memory-center-single-page-20261007/mutation-check.mjs
 */
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")

const VIEW = "src/components/novel/memory-center-view.tsx"
const TABS = "src/components/novel/memory-center-tabs.ts"
const SIDEBAR = "src/components/layout/sidebar-panel.tsx"
const DATA = "src/lib/novel/memory-center.ts"
const CSS = "src/components/uitest/ui-test-tools.css"

const SPECS = {
  view: "src/components/novel/memory-center-view.test.tsx",
  render: "src/components/novel/memory-center-view.render.spec.tsx",
  dismantling: "src/components/novel/memory-center-dismantling.spec.ts",
  sidebar: "src/components/layout/sidebar-panel.memory-center.test.tsx",
  css: "src/components/uitest/ui-test-memory-css.spec.ts",
  data: "src/lib/novel/memory-center.test.ts",
  tabs: "src/components/novel/memory-center-tabs.spec.ts",
}

/**
 * 每个变异：{ 名称, 文件, 找到的原文, 换成什么, 期望变红的测试文件 }
 * 「换成什么」必须真的把结构改回去，而不是改个无害的字符。
 */
const MUTATIONS = [
  {
    name: "M1 标签条不再锁 nowrap（退回会折行的写法）",
    file: CSS,
    from: '[data-ui="memory-tabs"] {\n  flex-wrap: nowrap;',
    to: '[data-ui="memory-tabs"] {\n  flex-wrap: wrap;',
    expectFail: [SPECS.css],
  },
  {
    name: "M2 把内层双栏的旧选择器加回样式里",
    file: CSS,
    from: "/* 记忆中心：单页单页 */",
    to: "/* 记忆中心：单页单页 */",
    // 这个变异在下面用自定位方式处理（见 applyMutation 的特例）
    custom: true,
    expectFail: [SPECS.css],
  },
  {
    name: "M3 视图重新读全局 selectedMemoryCenterEntry（双栏耦合回来）",
    file: VIEW,
    from: '  const [activeTab, setActiveTab] = useState<MemoryTabKey>("snapshots")',
    to: '  const [activeTab, setActiveTab] = useState<MemoryTabKey>("snapshots")\n  void useWikiStore((s) => s.selectedMemoryCenterEntry)',
    expectFail: [SPECS.view],
  },
  {
    name: "M4 标签清单里塞回 dismantling-library",
    file: TABS,
    from: '  "snapshots",\n  "outline-snapshots",',
    to: '  "snapshots",\n  "outline-snapshots",\n  "dismantling-library" as MemoryTabKey,',
    expectFail: [SPECS.dismantling, SPECS.tabs],
  },
  {
    name: "M5 标签条不再遍历清单常量",
    file: VIEW,
    from: "MEMORY_TAB_KEYS.map((key) => {",
    to: '(["snapshots"] as MemoryTabKey[]).map((key) => {',
    expectFail: [SPECS.dismantling],
  },
  {
    name: "M6 侧栏重新引入 novelMode 读取",
    file: SIDEBAR,
    from: "  const activeView = useWikiStore((s) => s.activeView)",
    to: "  const activeView = useWikiStore((s) => s.activeView)\n  void useWikiStore((s) => s.novelMode)",
    expectFail: [SPECS.sidebar],
  },
  {
    name: "M7 数据层重新截断到 10 条",
    file: DATA,
    from: "    snapshots: allSnapshotCards,",
    to: "    snapshots: allSnapshotCards.slice(0, 10),",
    expectFail: [SPECS.data],
  },
  {
    name: "M8 大纲卡片改回按哈希编号排序",
    file: TABS,
    from: '      const byTitle = (a.chapterTitle ?? "").localeCompare(b.chapterTitle ?? "", "zh")',
    to: "      const byTitle = 0",
    expectFail: [SPECS.tabs],
  },
  {
    name: "M9 大纲兜底标题重新带上负号",
    file: TABS,
    from: "    number: Math.abs(card.chapterNumber),",
    to: "    number: card.chapterNumber,",
    // 大纲兜底只有 tabs 单测覆盖（render 里的大纲卡片都带标题，走不到兜底分支）
    expectFail: [SPECS.tabs],
  },
]

/**
 * 本仓库里预存文件是 CRLF、新写文件是 LF，`\n` 直接匹配会漏。
 * 先按原文试，再按 CRLF 试。
 */
function applyReplace(original, from, to) {
  if (original.includes(from)) return original.replace(from, to)
  const crlfFrom = from.replace(/\n/g, "\r\n")
  if (original.includes(crlfFrom)) {
    return original.replace(crlfFrom, to.replace(/\n/g, "\r\n"))
  }
  return null
}

function runSpecs(specs) {
  const result = spawnSync(
    "npx.cmd",
    [
      "vitest", "run", ...specs,
      "--exclude", "**/.codex-temp/**",
      "--exclude", "**/.claude/**",
      "--exclude", "**/.worktrees/**",
    ],
    { cwd: root, encoding: "utf8", shell: false },
  )
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

let failures = 0
let checked = 0

for (const mutation of MUTATIONS) {
  const path = resolve(root, mutation.file)
  const original = readFileSync(path, "utf8")

  let mutated
  if (mutation.custom) {
    // M2：在记忆段落里插入一条 memory-snapshots 规则，模拟双栏样式残留
    const anchor = '[data-ui="memory-tabs"] {'
    mutated = original.includes(anchor)
      ? original.replace(anchor, '.ui-test-root [data-ui="memory-snapshots"] { height: auto; }\n\n' + anchor)
      : null
  } else {
    mutated = applyReplace(original, mutation.from, mutation.to)
  }

  if (mutated === null) {
    console.log(`  跳过（找不到原文，脚本需更新）: ${mutation.name}`)
    failures += 1
    continue
  }

  try {
    writeFileSync(path, mutated, "utf8")

    /*
     * 逐个文件单独验证，而不是把期望变红的文件一起跑一次。
     * 合并跑的话，"列了 2 个文件、其实只有 1 个会红"也会通过 ——
     * 那会让这份清单谎报覆盖范围。这里要求列出的**每一个**都真的红。
     */
    let allRed = true
    const notRed = []
    for (const spec of mutation.expectFail) {
      const { status } = runSpecs([spec])
      if (status === 0) {
        allRed = false
        notRed.push(spec)
      }
    }
    checked += 1

    if (allRed) {
      console.log(`  通过  ${mutation.name}`)
      console.log(`        ${mutation.expectFail.length} 个测试文件逐一变红: ${mutation.expectFail.join(", ")}`)
    } else {
      failures += 1
      console.log(`  失败  ${mutation.name}`)
      console.log(`        这些测试文件在变异后仍然全绿（断言抓不到该缺陷）: ${notRed.join(", ")}`)
    }
  } finally {
    writeFileSync(path, original, "utf8")
  }
}

console.log(`\n共校验 ${checked} 个变异，问题 ${failures} 个`)
process.exitCode = failures === 0 ? 0 : 1

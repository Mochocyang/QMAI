// @vitest-environment jsdom
//
// 生成 check.mjs 使用的 markup 快照。
//
// 为什么要有这个文件：check.mjs 只在真实 Chromium 里量布局，它本身渲染不出 React。
// 上一轮（docs/book-workbench-relayout）是手写了一份 dump.html，结果组件改了以后
// 那份快照没人更新，脚本还在拿旧 DOM 当"验证过"的证据。
//
// 所以这里改成用**真实组件**渲染出 markup 再落盘：dump.html 永远和组件同步，
// 而 check.mjs 只负责"把真实 CSS + 真实 markup 放进浏览器量尺寸"这一件事。
//
// 重新生成：npx vitest run docs/book-analysis-legacy-merge-20261006/dump-legacy-markup.spec.tsx --exclude '**/.codex-temp/**' --exclude '**/.claude/**'
// （普通跑测试时它也会同步刷新，内容确定，不会产生无谓 diff。）

import { writeFileSync } from "node:fs"
import path from "node:path"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { LegacySkillResults } from "@/components/novel/legacy-skill-results"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import { computeStyleMetrics } from "@/lib/novel/book-analysis/style-metrics"

// StoryMapContent 会读盘，按 story-map-content.spec.tsx 的方式打桩。
const listStoryMapHistory = vi.hoisted(() => vi.fn())
const readFile = vi.hoisted(() => vi.fn())

vi.mock("@/commands/fs", () => ({ readFile }))
vi.mock("@/lib/novel/book-analysis/story-map-history", () => ({ listStoryMapHistory }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseCharacter = {
  id: "char-linjing",
  name: "林烬",
  aliases: [],
  importance: 9,
  category: "protagonist" as const,
  firstAppearance: 1,
  lastAppearance: 3,
  appearanceCount: 3,
  description: "旧城巡夜人。",
  personality: "克制。",
  speechStyle: "短句。",
  relationships: [],
  keyEvents: [],
  corpus: "",
}

const book: BookAnalysisLibraryBook = {
  id: "book-1",
  path: "E:/Novel/book-analysis/book-1",
  metadata: { title: "长夜书", totalChapters: 3, totalWords: 12000, sourceType: "file", createdAt: 1, updatedAt: 2 },
  recognizedCharacters: [],
  characters: [
    baseCharacter,
    { ...baseCharacter, id: "char-suwan", name: "苏晚", importance: 7, category: "supporting" },
  ],
  skills: [
    { id: "skill-char-linjing", characterId: "char-linjing", characterName: "林烬", skillContent: "# 林烬 Skill", sourceBook: "长夜书", chapterRange: ["1", "3"], createdAt: 3 },
    { id: "skill-char-suwan", characterId: "char-suwan", characterName: "苏晚", skillContent: "# 苏晚 Skill", sourceBook: "长夜书", chapterRange: ["1", "2"], createdAt: 3 },
  ],
  styleProfile: {
    schemaVersion: 2,
    generatedAt: 3,
    sampledChapterIds: ["chapter-1"],
    metrics: computeStyleMetrics(["他走了。她没动。\n\n“别过来。”"]),
    layers: { languageDna: "句子偏短，多用句号收尾。", structurePatterns: "", cognitiveFrame: "", rhythmGuide: "" },
    integratedDna: "# Writing DNA\n\n句子偏短，多用句号收尾。",
    constitution: "不要写超过二十字的长句。",
    samples: ["他走了。她没动。"],
  },
  styleStatus: "enabled",
  boundAurasCount: 0,
  addedAuraCharacterIds: [],
  evidence: [],
}

const storyMap = {
  schemaVersion: 1 as const,
  bookId: "book-1",
  bookTitle: "长夜书",
  mainLineLabel: "主线A",
  mainSummary: "摘要",
  createdAt: 100,
  chapters: [
    {
      id: "ch-1",
      order: 1,
      title: "第1章",
      summary: "摘要",
      mainEvents: [{ label: "主线事件1", beats: [], characters: [] }],
      branches: [],
    },
  ],
}

const SKILLS = ["characters", "story", "style"] as const

/**
 * 新版结果区的真实外壳：这些 class 来自 book-analysis-workbench.tsx 的结果区，
 * 里面塞进真实渲染出来的 LegacySkillResults。行内样式/结构都来自组件本身，不是我手写的。
 */
function shell(skillLabel: string, inner: string) {
  return `<div class="book-workbench" data-testid="book-workbench"><div class="wb-inner">
<section class="wb-section wb-results-section">
<div class="wb-tabs" role="tablist" aria-label="分析结果"><button role="tab" aria-selected="true">${skillLabel}</button></div>
<p class="wb-muted">暂无新版本结果。</p>
${inner}
</section>
</div></div>`
}

const TAB_LABEL: Record<(typeof SKILLS)[number], string> = {
  characters: "角色 Skill",
  story: "故事 Skill",
  style: "文风 Skill",
}

describe("生成几何检查用的 markup 快照", () => {
  it("把三个页签下真实渲染的旧版结果区写成 dump.html", async () => {
    listStoryMapHistory.mockResolvedValue([
      {
        dirName: "story-map-100",
        map: storyMap,
        jsonPath: "E:/Novel/book-analysis/book-1/story-maps/story-map-100/story-map.json",
        htmlPath: "E:/Novel/book-analysis/book-1/story-maps/story-map-100/story-map.html",
      },
    ])
    readFile.mockResolvedValue("<html><body>map</body></html>")

    const parts: string[] = []
    for (const skill of SKILLS) {
      const container = document.createElement("div")
      document.body.appendChild(container)
      const root = createRoot(container)
      act(() => {
        root.render(<LegacySkillResults book={book} skill={skill} />)
      })
      // 故事页签要等读盘那次 effect 落地，否则快照里只有一句"尚未提取故事导图"。
      await act(async () => {})
      const inner = container.innerHTML
      expect(inner).toContain('data-testid="legacy-skill-results"')
      parts.push(`<div data-skill="${skill}">${shell(TAB_LABEL[skill], inner)}</div>`)
      act(() => root.unmount())
      document.body.removeChild(container)
    }

    const html = `<!-- 由 dump-legacy-markup.spec.tsx 用真实组件渲染生成，请勿手改。 -->\n${parts.join("\n")}\n`
    writeFileSync(path.resolve("docs/book-analysis-legacy-merge-20261006/dump.html"), html, "utf8")
    // 快照必须真的含有结果，否则 check.mjs 会在一份空文档上"全部通过"。
    expect(html).toContain("旧版资料")
    expect(html).toContain("查看全部")
  })
})

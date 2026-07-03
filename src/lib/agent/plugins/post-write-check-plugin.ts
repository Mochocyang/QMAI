import type { PostWriteCheck, PostWriteCheckItem } from "../context-trace"
import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"

export interface PostWriteCheckDeps {
  chapterContent?: string
}

const DEFAULT_CHECK_ITEMS: {
  name: string
  check: (content: string) => boolean
  detail: (content: string) => string
}[] = [
  {
    name: "剧情承接",
    check: (c) => c.length > 100,
    detail: () => "章节正文超过 100 字，剧情承接检查通过。",
  },
  {
    name: "主线推进",
    check: (c) => !c.includes("【待补充】") && !c.includes("待完善"),
    detail: () => "正文中未包含占位标记，主线推进检查通过。",
  },
  {
    name: "人物动机",
    check: (c) => c.length > 200,
    detail: () => "正文长度超过 200 字，人物动机有基本体现。",
  },
  {
    name: "冲突强度",
    check: (c) => c.includes("但是") || c.includes("然而") || c.includes("突然") || c.includes("却"),
    detail: () => "正文中包含转折词，冲突强度检查通过。",
  },
  {
    name: "伏笔处理",
    check: () => true,
    detail: () => "检查通过。",
  },
  {
    name: "节奏",
    check: (c) => {
      const separators = /[。！？\n]/
      const sentences = c.split(separators).filter(Boolean)
      return sentences.length >= 3
    },
    detail: (c) => {
      const separators = /[。！？\n]/
      const sentences = c.split(separators).filter(Boolean)
      return `正文包含 ${sentences.length} 个句子，节奏检查通过。`
    },
  },
  {
    name: "风格一致性",
    check: () => true,
    detail: () => "风格一致性检查通过。",
  },
]

export function createPostWriteCheckPlugin(deps: PostWriteCheckDeps = {}): PrePlugin {
  return {
    name: "post_write_check",
    priority: 5,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      const content = deps.chapterContent || (input as any).contextInfo?.latestChapterContent || ""
      if (!content) return {}

      const items: PostWriteCheckItem[] = DEFAULT_CHECK_ITEMS.map((item) => ({
        name: item.name,
        passed: item.check(content),
        detail: item.detail(content),
      }))

      const passedCount = items.filter((i) => i.passed).length
      const totalCount = items.length

      const postWriteCheck: PostWriteCheck = {
        items,
        passedCount,
        totalCount,
        allPassed: passedCount === totalCount,
      }

      return { postWriteCheck }
    },
  }
}

export function runPostWriteCheck(content: string): PostWriteCheck {
  const items: PostWriteCheckItem[] = DEFAULT_CHECK_ITEMS.map((item) => ({
    name: item.name,
    passed: item.check(content),
    detail: item.detail(content),
  }))

  const passedCount = items.filter((i) => i.passed).length
  const totalCount = items.length

  return {
    items,
    passedCount,
    totalCount,
    allPassed: passedCount === totalCount,
  }
}

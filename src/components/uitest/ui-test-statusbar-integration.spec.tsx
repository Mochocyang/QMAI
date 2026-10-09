// @vitest-environment jsdom

/**
 * 「写作字数」状态栏的端到端通路。
 *
 * 单测已覆盖差分引擎本身（`src/lib/writing-stats.spec.ts`）；这里要钉的是
 * **编辑器真的把每一次击键交到了记账口**——这是最容易悄悄断掉的一段：
 * `handleSave` 里那句 `recordChapter` 一旦被挪到「与磁盘一致就 return」之后，
 * 退格就不再扣减，而引擎单测依然是全绿的。
 */

import { readFileSync } from "node:fs"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { useWritingStatsStore } from "@/stores/writing-stats-store"

const fixture = vi.hoisted(() => ({
  files: new Map<string, string>(),
  write: vi.fn(),
}))

vi.mock("@/commands/fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/commands/fs")>(),
  readFile: vi.fn(async (path: string) => {
    if (!fixture.files.has(path)) throw new Error("文件不存在")
    return fixture.files.get(path)!
  }),
  writeFileAtomic: (...args: unknown[]) => fixture.write(...args),
  deleteFile: vi.fn(async (path: string) => { fixture.files.delete(path) }),
  writeFileIfAbsent: vi.fn(async (path: string, markdown: string) => {
    if (fixture.files.has(path)) throw new Error("文件已存在")
    fixture.files.set(path, markdown)
  }),
  fileExists: vi.fn(async (path: string) => fixture.files.has(path)),
  listDirectory: vi.fn(async () => []),
  /*
   * `createDirectory` 必须换掉。
   *
   * 写作统计落盘前会先建 `<project>/.novel/`。这里若沿用真实实现，
   * 它会去调 Tauri 的 fs 插件并在 jsdom 里抛错，而 `flush()` 的 catch 是
   * **故意静默**的（统计写盘失败不该打扰用户），于是表现为「测试里一次盘都没写」，
   * 却看不到任何错误。第一版就是这么被误导的。
   */
  createDirectory: vi.fn(async () => {}),
}))
vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/project-store")>(),
  saveNovelConfig: vi.fn(async () => {}),
}))
vi.mock("@/components/skill-library/use-de-ai-skill-options", () => ({
  useDeAiSkillOptions: () => ({ loading: false, skills: [], effectiveName: "未启用", currentSkillId: null, defaultSkillId: null, loadError: "" }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const project = { id: "writing-stats-e2e", name: "字数测试书", path: "C:/stats-book" }
const chapterPath = `${project.path}/wiki/chapters/第1章.md`
const originalBody = "雨停了。"
const chapter = `---\ntype: chapter\nchapter_number: 1\nchapter_status: draft\n---\n\n# 第1章 试炼\n\n${originalBody}`

let container: HTMLDivElement
let root: Root

async function mount() {
  useWikiStore.setState({ project, selectedFile: chapterPath, novelMode: true, activeView: "wiki" })
  await act(async () => { root.render(<div className="ui-test-root"><PreviewPanel /></div>) })
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
}

function textarea(): HTMLTextAreaElement {
  const node = container.querySelector<HTMLTextAreaElement>("[data-writing-editor] textarea")
  expect(node, "应渲染沉浸式正文编辑器").not.toBeNull()
  return node!
}

function changeTextarea(node: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  setter.call(node, value)
  node.dispatchEvent(new Event("input", { bubbles: true }))
}

/** 模拟逐字敲入。 */
async function type(text: string) {
  for (const char of text) {
    const node = textarea()
    await act(async () => { changeTextarea(node, `${node.value}${char}`) })
  }
}

/** 模拟连续退格 n 次。 */
async function backspace(times: number) {
  for (let i = 0; i < times; i += 1) {
    const node = textarea()
    await act(async () => { changeTextarea(node, node.value.slice(0, -1)) })
  }
}

const stats = () => useWritingStatsStore.getState()

const statsFilePath = `${project.path}/.novel/writing-stats.json`

/**
 * 取最近一次写作统计落盘。
 *
 * `writeFileAtomic` 同时被章节保存和统计落盘使用，所以必须按路径挑，
 * 否则会把章节 Markdown 当 JSON 解析（第一版就是这么挂的）。
 * 同时把它放回 `fixture.files`，模拟「真的写到了盘上」。
 */
function lastStatsWrite(): { path: string; file: Record<string, any> } {
  const call = [...fixture.write.mock.calls]
    .reverse()
    .find(([path]) => String(path).endsWith("writing-stats.json"))
  expect(call, "应已把写作统计落盘").toBeDefined()
  const [path, payload] = call as [string, string]
  return { path, file: JSON.parse(payload) }
}

/**
 * 模拟重启：清空内存中的 store，但保留 `fixture.files` 这份「磁盘」。
 *
 * 刻意**不**去改 `@/commands/fs` 的 mock 实现。`vi.restoreAllMocks()` 只还原
 * `vi.spyOn` 建的 spy，对 `vi.mock` 工厂里的 `vi.fn` **无效** —— 第一版在这里
 * 用 mockImplementation 覆盖读写，结果上一个用例的覆盖漏进了下一个用例，
 * 表现为「今日手写莫名其妙翻倍」这种极难定位的假失败。所有「磁盘状态」
 * 一律走 fixture.files，就再也没有跨用例的隐蔽状态。
 */
async function restartWithDisk() {
  stats().reset()
  await stats().initializeProject(project.path)
}

beforeEach(async () => {
  fixture.files.clear()
  fixture.files.set(chapterPath, chapter)
  fixture.write.mockReset().mockImplementation(async (path: string, markdown: string) => { fixture.files.set(path, markdown) })
  useWikiStore.setState(useWikiStore.getInitialState())
  useOutlineGenerationStore.setState({ tasks: [], panelOpen: false })
  stats().reset()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  // 打开项目：记账需要 projectPath，否则 recordChapter 是空操作。
  await stats().initializeProject(project.path)
})

afterEach(async () => {
  await act(async () => { useWikiStore.setState({ selectedFile: null, fileContent: "" }) })
  await act(async () => { root.unmount() })
  container.remove()
  stats().reset()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("打开章节", () => {
  it("已有正文不计入今日手写（打开一本旧书不等于今天写了几万字）", async () => {
    await mount()
    expect(stats().humanChars).toBe(0)
    expect(stats().aiChars).toBe(0)
  })

  it("编辑器里的字数与记账口径一致（口径漂移会让两处显示不同数字）", async () => {
    await mount()
    await type("他推开门。")
    expect(stats().humanChars).toBe("他推开门。".length)
  })
})

describe("手动写作逐字统计", () => {
  it("每敲一个字，手写那一栏就加一", async () => {
    await mount()
    await type("他")
    expect(stats().humanChars).toBe(1)
    await type("推开门")
    expect(stats().humanChars).toBe(4)
  })

  it("退格逐个扣减手写字数", async () => {
    await mount()
    await type("他推开门。")
    expect(stats().humanChars).toBe(5)
    await backspace(1)
    expect(stats().humanChars).toBe(4)
    await backspace(2)
    expect(stats().humanChars).toBe(2)
  })

  it("写完再全删，手写字数回到 0 而不是停在峰值", async () => {
    await mount()
    await type("他推开门。")
    await backspace("他推开门。".length)
    expect(stats().humanChars).toBe(0)
  })

  it("删到 0 以下不会变成负数", async () => {
    await mount()
    await type("他")
    await backspace(5)
    expect(stats().humanChars).toBe(0)
  })

  it("中间插入只算新插入的字", async () => {
    await mount()
    await type("推开门。")
    const node = textarea()
    // 在原有正文「雨停了。」前面插入三个字，正文其余部分逐字不动
    await act(async () => {
      changeTextarea(node, node.value.replace(originalBody, `他慢慢${originalBody}`))
    })
    // 此前已敲入「推开门。」4 字，本次插入「他慢慢」3 字
    expect(stats().humanChars).toBe("推开门。".length + "他慢慢".length)
  })

  it("AI 生成的那部分不因为手写而变成手写", async () => {
    await mount()
    // 先在别处记一笔 AI（模拟聊天里生成并保存的一章）
    const otherPath = `${project.path}/wiki/chapters/第2章.md`
    const aiBody = "斗气分九段，萧炎曾是天才。"
    stats().recordChapter(otherPath, `---\ntype: chapter\n---\n\n# 第2章\n\n${aiBody}`, "ai")
    expect(stats().aiChars).toBe(aiBody.length)

    await type("新写的一句。")
    // 手写增加，AI 那一栏一分不动
    expect(stats().humanChars).toBe("新写的一句。".length)
    expect(stats().aiChars).toBe(aiBody.length)
  })
})

describe("状态栏与记账同源", () => {
  it("状态栏里的手写数字与引擎当场一致", async () => {
    await mount()
    await type("他推开门。")
    // 这是 UI 组件读的同一份 state
    expect(stats().humanChars).toBe(5)
    expect(stats().humanChars + stats().aiChars).toBe(5)
  })
})

describe("落盘与恢复", () => {
  it("打字后落盘的摘要含长度、哈希与游程", async () => {
    await mount()
    await type("他推开门。")
    // 直接 flush，不等 2.5s 节流：节流本身由 store 单测覆盖（假定时器 + React act
    // 一起用会让 flush 的 promise 链不落地，这里没必要为它冒这个风险），
    // 本用例只关心「编辑器打的字最终写出的摘要长什么样」。
    await act(async () => { await stats().flush() })

    const { file } = lastStatsWrite()
    const entry = file.chapters["wiki/chapters/第1章.md"]
    expect(entry.len).toBe(`${originalBody}他推开门。`.length)
    expect(entry.rle).toBe(`u${originalBody.length}h${"他推开门。".length}`)
    expect(typeof entry.hash).toBe("string")
    // 今日手写在 days 里
    const todayKey = Object.keys(file.days).at(-1)!
    expect(file.days[todayKey].humanChars).toBe(5)
  })

  it("重开软件后今日数字还在，且磁盘正文与摘要一致时归属能恢复", async () => {
    await mount()
    await type("他推开门。")
    await act(async () => { await stats().flush() })
    // 统计确实落在了约定的位置（.novel/writing-stats.json）
    expect(lastStatsWrite().path).toBe(statsFilePath)

    // 真实场景里章节正文也会被保存（1s 防抖），所以磁盘上的正文必须与
    // 统计摘要对得上；否则恢复时按设计重打基线（长度/哈希校验），归属就丢了。
    const typedChapter = chapter.replace(originalBody, `${originalBody}他推开门。`)
    fixture.files.set(chapterPath, typedChapter)

    await restartWithDisk()
    // 今日数字按落盘恢复（那是当天已经记下的账）
    expect(stats().humanChars).toBe(5)

    // 重新打开这一章：磁盘正文与摘要一致，所以归属账本能恢复
    stats().primeChapter(chapterPath, typedChapter)
    // 原正文是「打开时就存在」的 → unknown；此后手工敲的 5 个字 → human
    expect(stats().provenance["wiki/chapters/第1章.md"]?.sources).toEqual([
      ...new Array(originalBody.length).fill("unknown"),
      ...new Array("他推开门。".length).fill("human"),
    ])

    // 把刚手写的 5 个字删掉 → 手写归零。
    // 若账本没恢复，这里会走「首次见到 → 只打基线」，手写会停在 5 不动。
    stats().recordChapter(chapterPath, chapter, "human")
    expect(stats().humanChars).toBe(0)
    expect(stats().aiChars).toBe(0)
  })

  it("磁盘正文与统计摘要对不上时重打基线，不把差额算成今天写的", async () => {
    await mount()
    await type("他推开门。")
    await act(async () => { await stats().flush() })
    expect(lastStatsWrite().path).toBe(statsFilePath)

    // 故意不让章节落盘：磁盘上还是原始正文，与摘要记录的内容不一致
    // （例如另一个编辑器改了文件、或外部同步覆盖过）
    await restartWithDisk()
    expect(stats().humanChars).toBe(5)

    // 重新打开这一章：长度对不上 → 按设计重打基线，绝不猜着对齐
    stats().primeChapter(chapterPath, chapter)
    expect(stats().provenance["wiki/chapters/第1章.md"]?.sources.every((s) => s === "unknown"))
      .toBe(true)

    // 此后这一章只按新基线记账：这次变更没有增减
    stats().recordChapter(chapterPath, chapter, "human")
    expect(stats().humanChars).toBe(5)
  })
})

describe("接线守卫", () => {
  /** 盘上是 CRLF（core.autocrlf=true），比对源码文本前必须先归一换行。 */
  const readSource = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n")

  it("记账发生在「与磁盘一致就返回」之前，否则退格不扣减", () => {
    const source = readSource("src/components/layout/preview-panel.tsx")
    const recordAt = source.indexOf("recordChapter(pathAtSave, persistedMarkdown")
    const earlyReturnAt = source.indexOf("if (persistedMarkdown === lastLoadedForPath) return")
    expect(recordAt, "handleSave 应调用 recordChapter 记账").toBeGreaterThan(-1)
    expect(earlyReturnAt, "handleSave 应有「与磁盘一致就返回」的短路").toBeGreaterThan(-1)
    expect(recordAt, "记账必须在短路之前，否则退格那一下会被吞掉").toBeLessThan(earlyReturnAt)
  })

  it("状态栏挂在 shell 的 .ui-test-app 里（写作与非写作两条渲染路径都覆盖）", () => {
    const shell = readSource("src/components/uitest/ui-test-shell.tsx")
    // 必须是 workspace 的兄弟节点而不是子节点，否则状态栏只会出现在主区右侧、不横跨整窗
    expect(
      shell,
      "状态栏应紧跟在 .ui-test-workspace 之后、作为 .ui-test-app 的直接子节点",
    ).toContain("</div>\n        {/* 未打开小说时不显示")
    expect(shell, "状态栏应只在打开小说后渲染").toContain("{project && <WritingStatusBar />}")
  })

  it("朗读名称用中文，且四项数据的标签不带任何英文", () => {
    const source = readSource("src/components/uitest/ui-test-statusbar.tsx")
    expect(source).toContain('aria-label="写作字数"')
    for (const label of ["总字数", "今日目标", "今日 AI 生成", "手写"]) {
      expect(source, `状态栏应包含中文标签「${label}」`).toContain(`>${label}<`)
    }
  })
})

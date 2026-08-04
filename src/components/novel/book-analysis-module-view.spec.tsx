import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import type { AnalysisModuleState, BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"
import { BookAnalysisModuleView } from "./book-analysis-module-view"

function moduleState(skill: AnalysisModuleState["skill"], status: AnalysisModuleState["status"]): AnalysisModuleState {
  return {
    skill,
    status,
    range: { startOrder: 1, endOrder: 20 },
    chunkIds: ["chunk-0001-0010", "chunk-0011-0020"],
    completedChunkIds: [],
    failedChunkId: null,
    resultPath: null,
    analysisVersion: 1,
    updatedAt: 1,
  }
}

const task: BookAnalysisPipelineTask = {
  version: 1,
  id: "task-1",
  batchId: null,
  projectPath: "E:/Novel",
  bookId: "book-1",
  bookPath: "E:/Novel/book-analysis/book-1",
  selectedSkills: ["characters", "style"],
  range: { startOrder: 1, endOrder: 20 },
  status: "running",
  currentSkill: "characters",
  modules: {
    characters: moduleState("characters", "running"),
    story: moduleState("story", "skipped"),
    style: moduleState("style", "pending"),
  },
  error: null,
  createdAt: 1,
  startedAt: 1,
  completedAt: null,
  updatedAt: 1,
}

const book: BookAnalysisLibraryBook = {
  id: "book-1",
  path: task.bookPath,
  metadata: {
    title: "测试作品",
    totalChapters: 20,
    totalWords: 20000,
    sourceType: "file",
    createdAt: 1,
    updatedAt: 1,
  },
  recognizedCharacters: [],
  characters: [],
  skills: [],
  styleStatus: "missing",
  boundAurasCount: 0,
  addedAuraCharacterIds: [],
  evidence: [],
  analysisManifest: {
    version: 1,
    bookId: "book-1",
    modules: { characters: moduleState("characters", "skipped") },
    updatedAt: 0,
  },
}

describe("BookAnalysisModuleView 分析进度", () => {
  it("当前任务状态优先于旧 manifest，并显示区块与下一步", () => {
    const html = renderToStaticMarkup(
      <BookAnalysisModuleView
        book={book}
        task={task}
        chunks={[
          {
            version: 1,
            id: "chunk-0001-0010",
            taskId: task.id,
            skill: "characters",
            chapterIds: ["ch-1"],
            startOrder: 1,
            endOrder: 10,
            wordCount: 1000,
            status: "running",
            attempts: 1,
            resultPath: null,
            error: null,
            startedAt: 1,
            completedAt: null,
            updatedAt: 1,
          },
          {
            version: 1,
            id: "chunk-0011-0020",
            taskId: task.id,
            skill: "characters",
            chapterIds: ["ch-11"],
            startOrder: 11,
            endOrder: 20,
            wordCount: 1000,
            status: "pending",
            attempts: 0,
            resultPath: null,
            error: null,
            startedAt: null,
            completedAt: null,
            updatedAt: 1,
          },
        ]}
        progresses={{
          "task-1:characters:chunk-0001-0010": {
            stageLabel: "识别角色中",
            percentage: 42,
            currentItem: "第一章",
          },
        }}
        selectedCharacterId={null}
        extractingStyle={false}
        addingToSoul={false}
        onSelectCharacter={vi.fn()}
        onToggleStyle={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onReextract={vi.fn()}
      />,
    )

    expect(html).toContain("分析任务进行中 · 当前：角色 Skill")
    expect(html).toContain("最近范围：第 1～20 章 · 完成区块 0/2")
    expect(html).toContain("当前区块：第 1/2 个（第 1～10 章）")
    expect(html).toContain("角色 Skill · 分析中")
    expect(html).toContain("文风 Skill · 待分析")
    expect(html).toContain("识别角色中")
    expect(html).toContain("42%")
    expect(html).toContain("第一章")
    expect(html).toContain("区块进度 0/2")
    // (0 + 0.42) / 2 * 90 ≈ 19
    expect(html).toContain("19%")
    expect(html).toContain('role="progressbar"')
    expect(html).not.toContain("完成区块 0/{total}")
    expect(html).not.toContain("未选择")
  })

  it("全部区块完成后汇总阶段整体进度落在 90–100，不会钉死 100% 前就封顶失效", () => {
    const html = renderToStaticMarkup(
      <BookAnalysisModuleView
        book={book}
        task={task}
        chunks={[
          {
            version: 1,
            id: "chunk-0001-0010",
            taskId: task.id,
            skill: "characters",
            chapterIds: ["ch-1"],
            startOrder: 1,
            endOrder: 10,
            wordCount: 1000,
            status: "completed",
            attempts: 1,
            resultPath: "a.result.json",
            error: null,
            startedAt: 1,
            completedAt: 2,
            updatedAt: 2,
          },
          {
            version: 1,
            id: "chunk-0011-0020",
            taskId: task.id,
            skill: "characters",
            chapterIds: ["ch-11"],
            startOrder: 11,
            endOrder: 20,
            wordCount: 1000,
            status: "completed",
            attempts: 1,
            resultPath: "b.result.json",
            error: null,
            startedAt: 1,
            completedAt: 2,
            updatedAt: 2,
          },
        ]}
        progresses={{
          "task-1:characters:aggregate": {
            stageLabel: "正在合并角色候选…",
            percentage: 93,
          },
        }}
        selectedCharacterId={null}
        extractingStyle={false}
        addingToSoul={false}
        onSelectCharacter={vi.fn()}
        onToggleStyle={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onReextract={vi.fn()}
      />,
    )

    expect(html).toContain("正在合并角色候选…")
    expect(html).toContain("区块进度 2/2")
    expect(html).toContain("93%")
    expect(html).not.toMatch(/aria-valuenow="100"/)
  })

  it("并发 running 区块的进度会累加进整体百分比", () => {
    const html = renderToStaticMarkup(
      <BookAnalysisModuleView
        book={book}
        task={task}
        chunks={[
          {
            version: 1,
            id: "chunk-0001-0010",
            taskId: task.id,
            skill: "characters",
            chapterIds: ["ch-1"],
            startOrder: 1,
            endOrder: 10,
            wordCount: 1000,
            status: "running",
            attempts: 1,
            resultPath: null,
            error: null,
            startedAt: 1,
            completedAt: null,
            updatedAt: 1,
          },
          {
            version: 1,
            id: "chunk-0011-0020",
            taskId: task.id,
            skill: "characters",
            chapterIds: ["ch-11"],
            startOrder: 11,
            endOrder: 20,
            wordCount: 1000,
            status: "running",
            attempts: 1,
            resultPath: null,
            error: null,
            startedAt: 1,
            completedAt: null,
            updatedAt: 1,
          },
        ]}
        progresses={{
          "task-1:characters:chunk-0001-0010": { stageLabel: "区块 A", percentage: 50 },
          "task-1:characters:chunk-0011-0020": { stageLabel: "区块 B", percentage: 50 },
        }}
        selectedCharacterId={null}
        extractingStyle={false}
        addingToSoul={false}
        onSelectCharacter={vi.fn()}
        onToggleStyle={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onReextract={vi.fn()}
      />,
    )

    // (0 + 0.5 + 0.5) / 2 * 90 = 45
    expect(html).toContain("45%")
  })

  it("待选择角色时展示选型入口", () => {
    const awaitingTask: BookAnalysisPipelineTask = {
      ...task,
      status: "awaiting-character-selection",
      currentSkill: null,
      recognizedCharacters: [{
        id: "char-1",
        name: "林远",
        aliases: [],
        appearances: 2,
        chapterIndices: [0],
        importanceScore: 90,
        category: "主角",
        sourceBook: "book-1",
      }],
      modules: {
        characters: moduleState("characters", "pending"),
        story: moduleState("story", "skipped"),
        style: moduleState("style", "skipped"),
      },
    }
    const html = renderToStaticMarkup(
      <BookAnalysisModuleView
        book={book}
        task={awaitingTask}
        selectedCharacterId={null}
        extractingStyle={false}
        addingToSoul={false}
        onSelectCharacter={vi.fn()}
        onToggleStyle={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onReextract={vi.fn()}
        onSelectCharacters={vi.fn()}
        onCancelTask={vi.fn()}
      />,
    )

    expect(html).toContain("待选择角色")
    expect(html).toContain("已识别 1 个角色")
    expect(html).toContain("选择角色")
    expect(html).toContain("取消任务")
  })

  it("角色识别中展示进度条", () => {
    const awaitingTask: BookAnalysisPipelineTask = {
      ...task,
      status: "awaiting-character-selection",
      currentSkill: null,
      recognizedCharacters: undefined,
      modules: {
        characters: moduleState("characters", "pending"),
        story: moduleState("story", "skipped"),
        style: moduleState("style", "skipped"),
      },
    }
    const html = renderToStaticMarkup(
      <BookAnalysisModuleView
        book={book}
        task={awaitingTask}
        progresses={{
          "task-1:characters:recognition": {
            stageLabel: "读取章节中（3/20）",
            percentage: 18,
            currentItem: "第 3 章 · 风起",
          },
        }}
        selectedCharacterId={null}
        extractingStyle={false}
        addingToSoul={false}
        onSelectCharacter={vi.fn()}
        onToggleStyle={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onReextract={vi.fn()}
        onCancelTask={vi.fn()}
      />,
    )

    expect(html).toContain("正在识别角色")
    expect(html).toContain("范围：第 3 章 · 风起")
    expect(html).toContain("读取章节中（3/20）")
    expect(html).toContain("18%")
    expect(html).toContain('role="progressbar"')
  })

  it("暂停继续文案使用 currentSkill 计数而非当前 Tab", () => {
    const pausedTask: BookAnalysisPipelineTask = {
      ...task,
      status: "paused",
      currentSkill: "characters",
    }
    const html = renderToStaticMarkup(
      <BookAnalysisModuleView
        book={book}
        task={pausedTask}
        chunks={[
          {
            version: 1,
            id: "chunk-0001-0010",
            taskId: task.id,
            skill: "characters",
            chapterIds: ["ch-1"],
            startOrder: 1,
            endOrder: 10,
            wordCount: 1000,
            status: "completed",
            attempts: 1,
            resultPath: "a.result.json",
            error: null,
            startedAt: 1,
            completedAt: 2,
            updatedAt: 2,
          },
          {
            version: 1,
            id: "chunk-0011-0020",
            taskId: task.id,
            skill: "characters",
            chapterIds: ["ch-11"],
            startOrder: 11,
            endOrder: 20,
            wordCount: 1000,
            status: "pending",
            attempts: 0,
            resultPath: null,
            error: null,
            startedAt: null,
            completedAt: null,
            updatedAt: 1,
          },
        ]}
        selectedCharacterId={null}
        extractingStyle={false}
        addingToSoul={false}
        onSelectCharacter={vi.fn()}
        onToggleStyle={vi.fn()}
        onAddSelectedSkillsToSoul={vi.fn()}
        onReextract={vi.fn()}
        onContinueTask={vi.fn()}
      />,
    )

    expect(html).toContain("从断点继续（已完成 1/2 区块）")
  })
})

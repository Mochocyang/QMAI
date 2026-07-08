import { describe, expect, it } from "vitest"
import {
  DEFAULT_OUTLINE_FOLDERS,
  DEFAULT_OUTLINE_FOLDER_PATHS,
  LEGACY_OUTLINE_FOLDER_MIGRATIONS,
  formatChapterOutlineFileName,
  inferOutlineSaveTarget,
  isPathInsideOutlineRoot,
  planOutlineFileMove,
} from "./outline-workbench"

describe("AI 大纲工作台核心逻辑", () => {
  it("提供大纲工作台默认文件夹", () => {
    expect(DEFAULT_OUTLINE_FOLDERS.map((folder) => folder.name)).toEqual([
      "大纲",
      "卷纲",
      "章纲",
      "人物小传",
      "设定",
      "伏笔",
      "组织",
    ])
  })

  it("提供设定文件夹默认子目录", () => {
    expect(DEFAULT_OUTLINE_FOLDER_PATHS).toEqual(expect.arrayContaining([
      "设定/角色",
      "设定/世界观",
      "设定/势力",
      "设定/伏笔",
      "设定/地图",
      "设定/状态",
    ]))
  })

  it("提供旧默认文件夹到新文件夹的迁移映射", () => {
    expect(LEGACY_OUTLINE_FOLDER_MIGRATIONS).toEqual([
      { from: "大纲文件夹", to: "大纲" },
      { from: "卷纲文件夹", to: "卷纲" },
      { from: "章纲文件夹", to: "章纲" },
      { from: "人物小传文件夹", to: "人物小传" },
      { from: "设定文件夹", to: "设定" },
      { from: "伏笔文件夹", to: "伏笔" },
      { from: "组织文件夹", to: "组织" },
    ])
  })

  it("按章纲标准生成第 N 章文件名", () => {
    expect(formatChapterOutlineFileName(1)).toBe("章纲-第001章.md")
    expect(formatChapterOutlineFileName(12, "账号:交接?")).toBe("章纲-第012章-账号-交接.md")
  })

  it("校验路径必须位于大纲根目录内", () => {
    const root = "C:/Book/wiki/outlines"

    expect(isPathInsideOutlineRoot("C:/Book/wiki/outlines/章纲/章纲-第001章.md", root)).toBe(true)
    expect(isPathInsideOutlineRoot("C:\\Book\\wiki\\outlines\\章纲\\章纲-第001章.md", root)).toBe(true)
    expect(isPathInsideOutlineRoot("C:/Book/wiki/outlines2/章纲-第001章.md", root)).toBe(false)
    expect(isPathInsideOutlineRoot("C:/Book/wiki/chapters/第001章.md", root)).toBe(false)
  })

  it("为大纲文件移动生成安全计划", () => {
    const plan = planOutlineFileMove({
      outlineRoot: "C:/Book/wiki/outlines",
      sourcePath: "C:/Book/wiki/outlines/章纲-第001章.md",
      targetFolderPath: "C:/Book/wiki/outlines/章纲",
      targetExists: false,
    })

    expect(plan).toEqual({
      ok: true,
      targetPath: "C:/Book/wiki/outlines/章纲/章纲-第001章.md",
    })
  })

  it("拒绝不安全或会覆盖的大纲移动", () => {
    expect(planOutlineFileMove({
      outlineRoot: "C:/Book/wiki/outlines",
      sourcePath: "C:/Book/wiki/chapters/第001章.md",
      targetFolderPath: "C:/Book/wiki/outlines/章纲",
      targetExists: false,
    })).toEqual({ ok: false, error: "只能移动大纲目录内的 Markdown 文件。" })

    expect(planOutlineFileMove({
      outlineRoot: "C:/Book/wiki/outlines",
      sourcePath: "C:/Book/wiki/outlines/章纲-第001章.md",
      targetFolderPath: "C:/Book/wiki/chapters",
      targetExists: false,
    })).toEqual({ ok: false, error: "目标文件夹必须位于大纲目录内。" })

    expect(planOutlineFileMove({
      outlineRoot: "C:/Book/wiki/outlines",
      sourcePath: "C:/Book/wiki/outlines/章纲-第001章.md",
      targetFolderPath: "C:/Book/wiki/outlines/章纲",
      targetExists: true,
    })).toEqual({ ok: false, error: "目标文件已存在，请更换文件夹或重命名后再移动。" })
  })

  it("根据 AI 大纲内容推断保存文件夹和文件名", () => {
    expect(inferOutlineSaveTarget("第1章 账号交接", "# 第1章 账号交接\n\n核心事件")).toEqual({
      folderName: "章纲",
      fileName: "章纲-第001章-账号交接.md",
      outlineType: "chapter-outline",
    })

    expect(inferOutlineSaveTarget("故事总纲", "# 故事总纲\n\n主线规划")).toEqual({
      folderName: "大纲",
      fileName: "故事总纲.md",
      outlineType: "story-outline",
    })
  })

  it("根据 AI 大纲内容自动分类到默认大纲文件夹", () => {
    expect(inferOutlineSaveTarget("第一卷 卷纲", "# 第一卷 卷纲\n\n阶段目标")).toMatchObject({
      folderName: "卷纲",
      outlineType: "volume-outline",
    })
    expect(inferOutlineSaveTarget("人物小传-男主", "# 人物小传-男主\n\n人物弧光")).toMatchObject({
      folderName: "人物小传",
      outlineType: "character-brief",
    })
    expect(inferOutlineSaveTarget("世界观设定", "# 世界观设定\n\n规则体系")).toMatchObject({
      folderName: "设定",
      outlineType: "setting-outline",
    })
    expect(inferOutlineSaveTarget("伏笔计划", "# 伏笔计划\n\n埋设与回收")).toMatchObject({
      folderName: "伏笔",
      outlineType: "foreshadowing-plan",
    })
    expect(inferOutlineSaveTarget("组织势力设定", "# 组织势力设定\n\n阵营关系")).toMatchObject({
      folderName: "组织",
      outlineType: "organization-outline",
    })
  })
})

import { describe, expect, it } from "vitest"
import {
  buildCharacterFileName,
  extractCharacterSaveDrafts,
} from "./character-save-extractor"

describe("character-save-extractor", () => {
  it("从 Markdown 标题中提取多个角色", () => {
    const result = extractCharacterSaveDrafts([
      "## 男主：林辰",
      "- 角色定位：男主",
      "- 核心动机：守住家人",
      "",
      "## 女主：苏晚",
      "- 角色定位：女主",
      "- 核心动机：查清真相",
    ].join("\n"))

    expect(result.drafts).toHaveLength(2)
    expect(result.drafts[0]).toMatchObject({
      characterName: "林辰",
      roleType: "男主",
      selected: true,
      fileName: "角色-男主-林辰.md",
      confidence: "high",
    })
    expect(result.drafts[1]).toMatchObject({
      characterName: "苏晚",
      roleType: "女主",
      fileName: "角色-女主-苏晚.md",
    })
  })

  it("从姓名和角色定位字段兜底提取单个角色", () => {
    const result = extractCharacterSaveDrafts([
      "姓名：顾沉",
      "角色定位：反派",
      "核心动机：夺回失去的权力",
    ].join("\n"))

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      characterName: "顾沉",
      roleType: "反派",
      fileName: "角色-反派-顾沉.md",
      confidence: "medium",
    })
  })

  it("缺少角色定位时生成低置信度未选中草稿", () => {
    const result = extractCharacterSaveDrafts([
      "姓名：顾沉",
      "核心动机：夺回失去的权力",
    ].join("\n"))

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      characterName: "顾沉",
      roleType: "角色",
      confidence: "low",
      selected: false,
    })
  })

  it("无法稳定识别角色名时返回错误提示", () => {
    const result = extractCharacterSaveDrafts("这是一段人物关系说明，但没有具体姓名。")

    expect(result.drafts).toEqual([])
    expect(result.errors.join("；")).toContain("未识别到可单独保存的角色")
  })

  it("不会把非角色 Markdown 标题识别为角色草稿", () => {
    const worldResult = extractCharacterSaveDrafts([
      "## 世界观",
      "- 灵气复苏后的都市秩序",
    ].join("\n"))
    const volumeResult = extractCharacterSaveDrafts([
      "## 第一卷：暗潮初起",
      "正文",
    ].join("\n"))

    expect(worldResult.drafts).toEqual([])
    expect(worldResult.errors.join("；")).toContain("未识别到可单独保存的角色")
    expect(volumeResult.drafts).toEqual([])
    expect(volumeResult.errors.join("；")).toContain("未识别到可单独保存的角色")
  })

  it("非角色标题附近出现角色定位时仍不生成角色草稿", () => {
    const worldResult = extractCharacterSaveDrafts([
      "## 世界观",
      "- 灵气复苏后的都市秩序",
      "- 角色定位：男主需要被社会规则压迫",
    ].join("\n"))
    const volumeResult = extractCharacterSaveDrafts([
      "## 第一卷：暗潮初起",
      "正文",
      "- 角色定位：男主",
    ].join("\n"))

    expect(worldResult.drafts).toEqual([])
    expect(worldResult.errors.join("；")).toContain("未识别到可单独保存的角色")
    expect(volumeResult.drafts).toEqual([])
    expect(volumeResult.errors.join("；")).toContain("未识别到可单独保存的角色")
  })

  it("无角色前缀但标题是人名且附近有角色定位时生成中置信度草稿", () => {
    const result = extractCharacterSaveDrafts([
      "## 林辰",
      "- 角色定位：男主",
      "- 核心动机：守住家人",
    ].join("\n"))

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      characterName: "林辰",
      roleType: "男主",
      fileName: "角色-男主-林辰.md",
      selected: true,
      confidence: "medium",
    })
  })

  it("支持新格式标题：姓名（角色）", () => {
    const result = extractCharacterSaveDrafts([
      "## 林辰（男主）",
      "- 核心动机：守住家人",
      "",
      "## 苏晚（女主）",
      "- 核心动机：查清真相",
    ].join("\n"))

    expect(result.drafts).toHaveLength(2)
    expect(result.drafts[0]).toMatchObject({
      characterName: "林辰",
      roleType: "男主",
      fileName: "角色-男主-林辰.md",
      selected: true,
      confidence: "high",
    })
    expect(result.drafts[1]).toMatchObject({
      characterName: "苏晚",
      roleType: "女主",
      fileName: "角色-女主-苏晚.md",
      selected: true,
      confidence: "high",
    })
  })

  it("支持新格式标题：姓名 - 角色", () => {
    const result = extractCharacterSaveDrafts([
      "## 林辰 - 男主",
      "- 核心动机：守住家人",
    ].join("\n"))

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      characterName: "林辰",
      roleType: "男主",
      selected: true,
      confidence: "high",
    })
  })

  it("支持新格式标题：角色设定：姓名", () => {
    const result = extractCharacterSaveDrafts([
      "## 角色设定：林辰",
      "- 角色定位：男主",
      "- 核心动机：守住家人",
    ].join("\n"))

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      characterName: "林辰",
      roleType: "男主",
      selected: true,
      confidence: "medium",
    })
  })

  it("清理角色文件名中的非法字符", () => {
    expect(buildCharacterFileName("男主", "林:辰/一号")).toBe("角色-男主-林-辰-一号.md")
  })

  it("无标题无字段时按段落兜底拆分多角色", () => {
    const result = extractCharacterSaveDrafts([
      "张三，男主，京城世家子弟，性格沉稳。",
      "",
      "苏晚，女主，江南书香门第，聪慧机敏。",
    ].join("\n"))

    expect(result.drafts).toHaveLength(2)
    expect(result.drafts[0]).toMatchObject({
      characterName: "张三",
      roleType: "男主",
      selected: true,
    })
    expect(result.drafts[1]).toMatchObject({
      characterName: "苏晚",
      roleType: "女主",
      selected: true,
    })
    expect(result.errors[0]).toContain("已按段落自动拆分")
  })

  it("段落兜底跳过不含角色关键字的段落", () => {
    const result = extractCharacterSaveDrafts([
      "张三，京城世家子弟，性格沉稳。",
      "",
      "苏晚，女主，江南书香门第，聪慧机敏。",
    ].join("\n"))

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].characterName).toBe("苏晚")
  })
})

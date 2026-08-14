import { describe, expect, it } from "vitest"
import {
  buildOutlineWizardPrompt,
  getOutlineWizardGenres,
  getOutlineWizardSkillNames,
  getOutlineWizardValidationError,
  OUTLINE_WIZARD_CHANNEL_OPTIONS,
  type OutlineWizardRequest,
} from "./outline-wizard"

const baseRequest: OutlineWizardRequest = {
  task: "newBook",
  length: "long",
  channel: "male",
  genre: "dushi",
  customGenre: "",
  inspiration: "一个穿越者靠军宣短视频改变国运",
  sellingPoints: ["家国高燃", "事业成长", "系统爽点"],
  targets: ["总纲", "卷纲", "章节规划表", "章纲"],
  scale: "100章左右",
  narrative: "thirdPerson",
  materialSource: "none",
}

describe("AI大纲生成向导请求", () => {
  it("不提供男女频融合选项", () => {
    expect(OUTLINE_WIZARD_CHANNEL_OPTIONS.map((option) => option.label)).toEqual([
      "男频",
      "女频",
      "暂不确定，让 AI 判断",
    ])
  })

  it("提交前必须填写故事灵感", () => {
    expect(getOutlineWizardValidationError({ ...baseRequest, inspiration: " " })).toBe(
      "请先填写故事灵感或处理要求。",
    )
  })

  it("男频时返回男频题材选项", () => {
    const labels = getOutlineWizardGenres("male").map((option) => option.label)
    expect(labels).toContain("都市")
    expect(labels).toContain("玄幻")
    expect(labels).toContain("规则怪谈")
  })

  it("女频时返回女频题材选项", () => {
    const labels = getOutlineWizardGenres("female").map((option) => option.label)
    expect(labels).toContain("现言")
    expect(labels).toContain("豪门总裁")
    expect(labels).toContain("知乎短篇")
  })

  it("构造发送给 AI 大纲对话的结构化中文 Prompt", () => {
    const prompt = buildOutlineWizardPrompt(baseRequest)
    expect(prompt).toContain("用户已提交小说生成需求")
    expect(prompt).toContain("- 任务：创建新书大纲")
    expect(prompt).toContain("- 篇幅：长篇小说")
    expect(prompt).toContain("- 频道：男频")
    expect(prompt).toContain("- 题材：都市")
    expect(prompt).toContain("- 故事灵感/处理要求：一个穿越者靠军宣短视频改变国运")
    expect(prompt).toContain("请先分析该需求，判断还缺少哪些必要信息。")
    expect(prompt).toContain("如果信息足够，请给出生成方案并询问用户是否确认开始生成。")
  })

  it("快速模式只保留需求事实，不注入 Skill 名单和固定工作流", () => {
    const prompt = buildOutlineWizardPrompt(baseRequest, { mode: "fast" })

    expect(prompt).toContain("用户已提交小说生成需求")
    expect(prompt).toContain("- 题材：都市")
    expect(prompt).toContain("直接生成可保存的大纲正文")
    expect(prompt).not.toContain("本次优先调用 Skill")
    expect(prompt).not.toContain("固定工作流")
    expect(prompt).not.toContain("请先分析该需求")
    expect(prompt).not.toContain("询问用户是否确认开始生成")
  })

  it("向导 Prompt 明确采用充分性闸门和分阶段生成工作流", () => {
    const prompt = buildOutlineWizardPrompt(baseRequest)

    expect(prompt).toContain("充分性闸门")
    expect(prompt).toContain("用户确认前不得生成完整文件")
    expect(prompt).toContain("先卷后章")
    expect(prompt).toContain("卷节拍表")
    expect(prompt).toContain("卷时间线")
    expect(prompt).toContain("滚动章纲")
    expect(prompt).toContain("新增设定写回")
    expect(prompt).toContain("质量检查")
  })

  it("按男频玄幻和女频幻想题材映射专用 Skill", () => {
    expect(getOutlineWizardSkillNames({
      ...baseRequest,
      channel: "male",
      genre: "xuanhuan",
    })).toEqual(expect.arrayContaining([
      "outline-master-builder",
      "male-xuanhuan-xianxia",
      "world-rules",
      "power-system",
    ]))

    expect(getOutlineWizardSkillNames({
      ...baseRequest,
      channel: "female",
      genre: "huanxiangyanqing",
    })).toEqual(expect.arrayContaining([
      "female-xuanhuan-fantasy",
      "relationship-emotion",
      "world-rules",
    ]))
  })
})

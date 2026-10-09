import { describe, expect, it } from "vitest"
import {
  buildFanficDemandSection,
  buildOutlineWizardPrompt,
  getOutlineWizardGenres,
  getOutlineWizardSkillNames,
  getOutlineWizardValidationError,
  isFanficRequest,
  OUTLINE_WIZARD_CHANNEL_OPTIONS,
  OUTLINE_WIZARD_CREATION_OPTIONS,
  OUTLINE_WIZARD_FANFIC_MODE_OPTIONS,
  resolveFanficDeviations,
  resolveFanficMode,
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

const fanficRequest: OutlineWizardRequest = {
  ...baseRequest,
  creation: "fanfic",
  genre: "tongren",
  fanficMode: "au",
  fanficCustomMode: "",
  fanficSourceName: "斗破苍穹",
  fanficSourceMaterial: "斗气大陆，斗气分九段。萧炎曾是天才，后跌为废物。",
  fanficAllowedDeviations: ["时间线整体后移十年"],
}

describe("同人创作支持", () => {
  it("创作类型提供原创与同人两项，且默认是原创", () => {
    expect(OUTLINE_WIZARD_CREATION_OPTIONS.map((option) => option.value)).toEqual([
      "original",
      "fanfic",
    ])
    expect(isFanficRequest(baseRequest)).toBe(false)
    expect(isFanficRequest({ ...baseRequest, creation: "original" })).toBe(false)
    expect(isFanficRequest(fanficRequest)).toBe(true)
  })

  it("同人模式覆盖正典延续/架空世界/性格重塑/CP 向/自定义", () => {
    expect(OUTLINE_WIZARD_FANFIC_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "canon",
      "au",
      "ooc",
      "cp",
      "custom",
    ])
  })

  it("男频与女频题材都能选到同人衍生", () => {
    expect(getOutlineWizardGenres("male").map((option) => option.value)).toContain("tongren")
    expect(getOutlineWizardGenres("female").map((option) => option.value)).toContain("tongren")
  })

  it("同人必填原作名称、模式与原作素材", () => {
    expect(getOutlineWizardValidationError({
      ...fanficRequest,
      fanficSourceName: " ",
    })).toBe("请填写原作名称，同人创作需要它来标识正典来源。")

    expect(getOutlineWizardValidationError({
      ...fanficRequest,
      fanficMode: "",
    })).toBe("请选择同人模式。")

    expect(getOutlineWizardValidationError({
      ...fanficRequest,
      fanficSourceMaterial: " ",
    })).toBe("请粘贴或导入原作素材，同人创作需要原作事实作为正典。")

    expect(getOutlineWizardValidationError(fanficRequest)).toBeNull()
  })

  it("自定义模式必须由用户描述边界，空描述被拦下", () => {
    expect(getOutlineWizardValidationError({
      ...fanficRequest,
      fanficMode: "custom",
      fanficCustomMode: "  ",
    })).toBe("请用自己的话描述本作与原作的关系边界。")

    expect(getOutlineWizardValidationError({
      ...fanficRequest,
      fanficMode: "custom",
      fanficCustomMode: "原作结局十年后的低魔日后谈",
    })).toBeNull()
  })

  it("原创作品完全不触发同人校验，既有行为不回退", () => {
    expect(getOutlineWizardValidationError(baseRequest)).toBeNull()
    expect(getOutlineWizardValidationError({
      ...baseRequest,
      genre: "tongren",
    })).toBeNull()
  })

  it("自定义模式取用户输入，标准模式取 key", () => {
    expect(resolveFanficMode(fanficRequest)).toBe("au")
    expect(resolveFanficMode({ ...fanficRequest, fanficMode: "custom", fanficCustomMode: " 日后谈 " }))
      .toBe("日后谈")
  })

  it("容许偏离会去掉空白项", () => {
    expect(resolveFanficDeviations({ ...fanficRequest, fanficAllowedDeviations: ["改了结局", " ", ""] }))
      .toEqual(["改了结局"])
    expect(resolveFanficDeviations(baseRequest)).toEqual([])
  })

  it("同人强制加载同人 Skill 与其支持 Skill", () => {
    const names = getOutlineWizardSkillNames(fanficRequest)
    expect(names).toContain("fanfic-derivative")
    expect(names).toContain("character-design")
    expect(names).toContain("relationship-emotion")
    expect(names).toContain("foreshadowing-suspense")
  })

  it("同人叠加在其它题材上仍然保留该题材 Skill，不互相替代", () => {
    const names = getOutlineWizardSkillNames({
      ...fanficRequest,
      genre: "xuanhuan",
    })
    expect(names).toContain("fanfic-derivative")
    expect(names).toContain("male-xuanhuan-xianxia")
    expect(names).toContain("power-system")
  })

  it("原创请求不会误加载同人 Skill", () => {
    expect(getOutlineWizardSkillNames(baseRequest)).not.toContain("fanfic-derivative")
    expect(getOutlineWizardSkillNames({ ...baseRequest, genre: "xuanhuan" }))
      .not.toContain("fanfic-derivative")
  })

  it("同人需求段把原作既成事实写成权威约束，并带上六条硬规则与模式边界", () => {
    const section = buildFanficDemandSection(fanficRequest)

    expect(section).toContain("## 同人创作约束（优先级高于原创度要求）")
    expect(section).toContain("原作已确立的事实是**权威**")
    expect(section).toContain("同人模式：架空世界（au）")
    expect(section).toContain("原作：斗破苍穹")
    expect(section).toContain("容许偏离：时间线整体后移十年")
    expect(section).toContain("原作正典卡")
    expect(section).toContain("原作未交代")
    expect(section).toContain("不要复读原作已写过的场景")
    expect(section).toContain("### 原作素材（正典来源）")
    expect(section).toContain("斗气大陆")
  })

  it("同人需求段写明与参考拆文的分工，避免两套相反规则打架", () => {
    const section = buildFanficDemandSection(fanficRequest)

    expect(section).toContain("## 与「参考拆文」的分工")
    expect(section).toContain("不包括本作原作")
    expect(section).toContain("既成事实必须沿用")
    expect(section).toContain("禁止抄录原作语句")
  })

  it("原创请求的同人需求段为空串", () => {
    expect(buildFanficDemandSection(baseRequest)).toBe("")
  })

  it("容许偏离为空时明确写出「无」，避免模型以为可以随意改", () => {
    const section = buildFanficDemandSection({ ...fanficRequest, fanficAllowedDeviations: [] })
    expect(section).toContain("容许偏离：无（除所选模式本身外，一切按原作正典处理）")
  })

  it("向导 Prompt 带出创作类型，并改用包含原作信息的充分性闸门", () => {
    const prompt = buildOutlineWizardPrompt(fanficRequest)

    expect(prompt).toContain("- 创作类型：同人创作（基于已有原作）")
    expect(prompt).toContain("同人创作约束")
    expect(prompt).toContain("原作名称、同人模式、原作正典信息")
    expect(prompt).toContain("fanfic-derivative")
  })

  it("原创 Prompt 不带同人内容，既有闸门文本不变", () => {
    const prompt = buildOutlineWizardPrompt(baseRequest)

    expect(prompt).toContain("- 创作类型：原创作品")
    expect(prompt).not.toContain("同人创作约束")
    expect(prompt).not.toContain("fanfic-derivative")
    expect(prompt).toContain("主要人物方向、世界观/背景方向")
  })

  it("快速模式的同人 Prompt 也带同人约束，避免绕过正典", () => {
    const prompt = buildOutlineWizardPrompt(fanficRequest, { mode: "fast" })

    expect(prompt).toContain("同人创作约束")
    expect(prompt).toContain("原作正典卡")
    expect(prompt).toContain("直接生成可保存的大纲正文")
    expect(prompt).not.toContain("固定工作流")
  })
})

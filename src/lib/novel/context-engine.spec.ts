import { describe, expect, it } from "vitest"
import { contextPackToPrompt, trimContextPack, type ContextPack } from "./context-engine"

const basePack: ContextPack = {
  task: "生成第2章正文",
  chapterGoal: "",
  outline: "",
  recentSummaries: [],
  previousChapterEnding: "",
  characterStates: "",
  soulDoc: "",
  characterAuras: "",
  cognitionStates: "",
  foreshadowingStates: "",
  timeline: "",
  relatedSettings: "",
  canonRules: "",
  writingStyle: "",
  searchResults: "",
  graphSearchResults: "",
  mustDo: "",
  mustAvoid: "",
  nextChapterAdvice: "",
  revisionDirectives: "",
  recentChapterContents: [],
}

describe("contextPackToPrompt", () => {
  it("将最近章节正文片段写入小说上下文包", () => {
    const prompt = contextPackToPrompt({
      ...basePack,
      recentChapterContents: [
        "## 第1章正文片段\n黑背心纹身大汉倒在雨里。",
      ],
    })

    expect(prompt).toContain("最近章节正文片段")
    expect(prompt).toContain("黑背心纹身大汉倒在雨里")
  })
})

describe("trimContextPack 两级裁剪", () => {
  const fullPack: ContextPack = {
    task: "生成第10章正文",
    chapterGoal: "主角遭遇反派，爆发冲突",
    mustDo: "必须让主角受伤",
    mustAvoid: "不能让主角死",
    soulDoc: "这是一部热血玄幻小说，主角性格坚毅，不服输。世界观设定为修仙世界，有灵气、功法、丹药等元素。整体节奏紧张，冲突不断。",
    outline: "第一卷：初入修仙界\n  第1章：觉醒\n  第2章：入门\n  第3章：试炼\n  第4章：秘境\n  第5章：传承\n  第6章：冲突\n  第7章：历练\n  第8章：结交\n  第9章：危机\n  第10章：大战",
    recentSummaries: [
      "第1章摘要：主角林小天是个普通山村少年，父母早亡，靠打猎为生。一日在山中打猎时，意外发现一个神秘山洞，洞中有一具骸骨和一枚玉佩。",
      "第2章摘要：林小天凭借玉佩的指引，来到青云宗参加入门考核。考核中他展现出惊人的毅力，被外门长老看中，收入外门。",
      "第3章摘要：入门后，林小天被分配到最低级的杂役院。他一边做杂役，一边偷偷修炼。凭借玉佩中的功法，他的进境远超同门。",
      "第4章摘要：三个月后，宗门举行小比，林小天一路过关斩将，最终获得第十名，得以进入秘境修炼。",
      "第5章摘要：秘境中，林小天意外获得上古传承，修为大幅提升。但也因此被宗门天才张天霸盯上，埋下祸根。",
      "第6章摘要：张天霸找林小天的麻烦，两人发生冲突。林小天虽然修为稍低，但凭借精妙的战斗意识，勉强打成平手。",
      "第7章摘要：为了提升实力，林小天申请下山历练。历练中他遇到妖兽潮，拼死斩杀妖兽，获得珍贵妖丹。",
      "第8章摘要：历练途中，林小天结识了同样下山历练的苏婉儿。两人结伴而行，经历了不少危险，结下深厚友谊。",
      "第9章摘要：回到宗门后，林小天发现张天霸勾结外门长老，设计陷害他。林小天被关入禁地，面临被废修为的危险。",
    ],
    previousChapterEnding: "林小天被两名外门弟子押着，一步步走向禁地。他的心中充满愤怒，但更多的是不甘。他不甘心就这样被废掉修为，他不甘心就这样认输。就在禁地大门即将关上的那一刻，他猛地抬起头，眼中闪过一道精光。",
    characterStates: "林小天：炼气九层，性格坚毅，身负神秘玉佩\n苏婉儿：炼气八层，善良聪慧，与主角交好\n张天霸：筑基初期，宗门天才，心胸狭窄",
    characterAuras: "林小天：不屈、热血、成长型\n苏婉儿：温柔、聪慧、辅助型\n张天霸：傲慢、残忍、反派型",
    foreshadowingStates: "玉佩秘密：未完全解开，疑似上古大能遗物\n秘境传承：仅获得基础功法，更深层传承待解锁\n苏婉儿身份：表面是普通弟子，似乎另有背景",
    cognitionStates: "林小天当前心态：愤怒但冷静，决心反击\n张天霸当前心态：傲慢自大，想彻底废掉主角\n苏婉儿当前心态：担忧主角安危，想办法营救",
    timeline: "第1章：山村觉醒\n第2章：入门青云宗\n第3章：杂役修炼\n第4章：宗门小比\n第5章：秘境传承\n第6章：初遇冲突\n第7章：下山历练\n第8章：结识婉儿\n第9章：被陷禁地\n第10章：大战在即",
    relatedSettings: "青云宗：正道七大宗之一，外门、内门、核心三层等级\n禁地：宗门重地，关押重犯之地\n玉佩：神秘上古遗物，内含功法传承",
    canonRules: "1. 修为等级：炼气、筑基、金丹、元婴、化神\n2. 妖兽等级：一阶到九阶，对应人类修为\n3. 宗门规矩：不得私斗，不得残害同门",
    writingStyle: "热血爽文风格，节奏快，冲突不断，主角光环明显但不过分。",
    searchResults: "搜索到相关内容：\n- 第3章：提到禁地的可怕\n- 第5章：提到玉佩的反应\n- 第7章：提到妖丹的用途",
    graphSearchResults: "图谱搜索结果：\n- 林小天 -> 敌对 -> 张天霸\n- 林小天 -> 朋友 -> 苏婉儿\n- 林小天 -> 拥有 -> 玉佩\n- 张天霸 -> 下属 -> 外门长老",
    nextChapterAdvice: "下一章建议：\n1. 禁地中林小天遇到机缘\n2. 张天霸亲自来禁地找事\n3. 大战爆发，林小天突破",
    revisionDirectives: "",
    recentChapterContents: [],
  }

  it("不超预算时不裁剪", () => {
    const result = trimContextPack(fullPack, 10000)
    expect(result.trimmedFields).toHaveLength(0)
    expect(result.trimmedChars).toBe(0)
    expect(result.finalChars).toBe(result.originalChars)
    expect(result.prompt).toContain("生成第10章正文")
    expect(result.prompt).toContain("第9章摘要")
  })

  it("第一级裁剪：从低优先级字段开始整个删除", () => {
    const result = trimContextPack(fullPack, 100)
    expect(result.trimmedFields.length).toBeGreaterThan(0)
    expect(result.finalChars).toBeLessThan(result.originalChars)
    expect(result.trimmedChars).toBeGreaterThan(0)
    expect(result.prompt).toContain("生成第10章正文")
    expect(result.prompt).toContain("主角遭遇反派")
    expect(result.trimmedFields).toContain("graphSearchResults")
    expect(result.trimmedFields).toContain("searchResults")
  })

  it("第二级裁剪：放不下的字段做内容精简", () => {
    const smallPack: ContextPack = {
      ...fullPack,
      searchResults: "",
      graphSearchResults: "",
      nextChapterAdvice: "",
      relatedSettings: "世界设定内容。" + "详细描述。".repeat(100),
      canonRules: "",
      writingStyle: "",
      timeline: "",
      revisionDirectives: "",
    }
    const result = trimContextPack(smallPack, 100)
    expect(result.partiallyTrimmedField).toBeDefined()
    expect(result.partiallyTrimmedField?.keptChars).toBeLessThan(result.partiallyTrimmedField?.originalChars ?? 0)
  })

  it("数组类型字段保留最后几条", () => {
    const longSummaries = Array.from({ length: 20 }, (_, i) => 
      `第${i + 1}章摘要：${"内容".repeat(20)}${i + 1}`
    )
    const result = trimContextPack({
      ...basePack,
      task: "测试",
      recentSummaries: longSummaries,
    }, 100)
    expect(result.partiallyTrimmedField).toBeDefined()
    expect(result.partiallyTrimmedField?.fieldKey).toBe("recentSummaries")
    expect(result.prompt).toContain("第20章摘要")
    expect(result.prompt).not.toContain("第1章摘要")
  })

  it("长文本字段保留开头和结尾", () => {
    const longText = "这是一段很长的设定文档。".repeat(200)
    const result = trimContextPack({
      ...basePack,
      task: "测试",
      soulDoc: longText,
    }, 100)
    expect(result.partiallyTrimmedField).toBeDefined()
    expect(result.partiallyTrimmedField?.fieldKey).toBe("soulDoc")
    expect(result.prompt.length).toBeLessThan(500)
    expect(result.prompt).toContain("设定文档")
  })

  it("高优先级字段始终保留", () => {
    const result = trimContextPack(fullPack, 50)
    expect(result.prompt).toContain("生成第10章正文")
    expect(result.prompt).toContain("主角遭遇反派")
  })

  it("裁剪结果包含裁剪提示信息", () => {
    const result = trimContextPack(fullPack, 100)
    expect(result.prompt).toContain("已裁剪")
    expect(result.prompt).toContain("低优先级上下文字段")
  })

  it("excludeOutline 选项跳过大纲", () => {
    const result = trimContextPack(fullPack, 10000, { excludeOutline: true })
    expect(result.prompt).not.toContain("第3章：试炼")
    expect(result.prompt).toContain("生成第10章正文")
  })
})

import { describe, expect, it } from "vitest"

import {
  classifyOutlineSaveTarget,
  getDefaultFolderForOutlineFileType,
  inferOutlineFileTypeFromSkills,
} from "./outline-save-classifier"

describe("outline-save-classifier", () => {
  it("按 fileType 返回默认保存文件夹", () => {
    expect(getDefaultFolderForOutlineFileType("outline")).toBe("大纲")
    expect(getDefaultFolderForOutlineFileType("volume-outline")).toBe("卷纲")
    expect(getDefaultFolderForOutlineFileType("chapter-outline")).toBe("章纲")
    expect(getDefaultFolderForOutlineFileType("character")).toBe("人物小传")
    expect(getDefaultFolderForOutlineFileType("setting")).toBe("设定")
    expect(getDefaultFolderForOutlineFileType("foreshadowing")).toBe("伏笔")
    expect(getDefaultFolderForOutlineFileType("organization")).toBe("组织")
    expect(getDefaultFolderForOutlineFileType("quality-report")).toBe("质量检查")
  })

  it("按 Skill 路由推断保存类型", () => {
    expect(inferOutlineFileTypeFromSkills(["ZhanggangSkill/chapter-outline-builder"])).toBe("chapter-outline")
    expect(inferOutlineFileTypeFromSkills(["JueseSkill/character-design"])).toBe("character")
    expect(inferOutlineFileTypeFromSkills(["SheDingSkill/faction-system"])).toBe("organization")
    expect(inferOutlineFileTypeFromSkills(["SheDingSkill/foreshadowing-suspense"])).toBe("foreshadowing")
    expect(inferOutlineFileTypeFromSkills(["SheDingSkill/world-rules"])).toBe("setting")
    expect(inferOutlineFileTypeFromSkills(["DagangSkill/main-outline-builder"])).toBe("outline")
  })

  it("用户显式选择优先于 Skill 和内容关键词", () => {
    expect(classifyOutlineSaveTarget({
      explicitFileType: "character",
      referencedSkills: ["ZhanggangSkill/chapter-outline-builder"],
      title: "第001章章纲",
      content: "# 第001章章纲",
    })).toMatchObject({
      fileType: "character",
      targetFolder: "人物小传",
    })
  })

  it("没有显式选择时按内容关键词兜底推断章纲文件名", () => {
    expect(classifyOutlineSaveTarget({
      title: "章纲-第001章",
      content: "## 核心事件",
    })).toMatchObject({
      fileType: "chapter-outline",
      targetFolder: "章纲",
      fileName: "章纲-第001章.md",
    })
  })

  it("人物小传标题已带 Markdown 后缀时不重复追加后缀", () => {
    expect(classifyOutlineSaveTarget({
      explicitFileType: "character",
      title: "角色-男主-林辰.md",
      content: "# 角色-男主-林辰",
    })).toMatchObject({
      fileType: "character",
      targetFolder: "人物小传",
      fileName: "角色-男主-林辰.md",
    })
  })

  it("卷纲关键词优先于正文中的章节编号", () => {
    expect(classifyOutlineSaveTarget({
      title: "第一卷卷纲",
      content: "第1章：主角进入新地图",
    })).toMatchObject({
      fileType: "volume-outline",
      targetFolder: "卷纲",
    })
  })

  it("标题的设定语义优先于正文里的「第N章」，不再误判成章纲", () => {
    // 例：一份力量体系总纲，正文提到「第12章解锁」——过去会被推断成章纲
    expect(classifyOutlineSaveTarget({
      title: "《黑雨之下》全版本力量体系总纲",
      content: "# 力量体系\n## 等级阶梯\n| 等级 | 说明 |\n| --- | --- |\n| 一转 | 第12章解锁 |",
    })).toMatchObject({
      fileType: "setting",
      targetFolder: "设定",
    })
    expect(classifyOutlineSaveTarget({
      title: "背景设定-大衍王朝",
      content: "# 背景设定\n## 历史沿革\n| 时期 | 事件 |\n| --- | --- |\n| 开元 | 第3章提及立国 |",
    })).toMatchObject({ fileType: "setting" })
  })

  it("章纲标题优先于正文里引用的卷纲节拍", () => {
    expect(classifyOutlineSaveTarget({
      title: "章纲-第46章：第一次冷处理",
      content: [
        "# 章纲-第46章：第一次冷处理",
        "",
        "## 上层依据",
        "- **卷纲节拍：** 终局期",
        "- 依据：卷纲/第一卷.md",
        "",
        "## 本章目标",
        "男主第一次被公司冷处理。",
      ].join("\n"),
    })).toMatchObject({
      fileType: "chapter-outline",
      targetFolder: "章纲",
      fileName: "章纲-第046章-第一次冷处理.md",
    })
  })

  it("用户原话是章纲时，正文引用卷纲不能改判成卷纲", () => {
    expect(classifyOutlineSaveTarget({
      title: "第一次冷处理",
      content: "## 上层依据\n- **卷纲节拍：** 终局期",
      sourceHint: "编写第 46 章章纲",
    })).toMatchObject({
      fileType: "chapter-outline",
      targetFolder: "章纲",
    })
  })
})

describe("event-outline 路由隔离", () => {
  /*
   * 「事件细纲」这个字符串**包含**「细纲」，而 CHAPTER_TYPE_MARK / CHAPTER_SUBJECT 都认「细纲」。
   * 所以只要模型漏写 fileType，事件细纲就会被按名字推断成 chapter-outline 并落进「章纲」文件夹 ——
   * 章纲写作上下文引擎的 resolveChapterOutline 随后会把它当成真正的 17 节章纲读走。
   * 这一组用例就是这条隔离保证的守卫：事件标记必须压过章纲标记。
   */
  const eventOutlineContent = [
    "# 第12章 · 令牌初现",
    "",
    "## 事件1 院子里的哭声",
    "- 关键台词：「夜壶里的东西是药。」",
    "- 神情动作：念念两只小手护住屁股蛋。",
  ].join("\n")

  it("标题带「事件细纲」时不被「细纲」抢成章纲", () => {
    expect(classifyOutlineSaveTarget({
      title: "事件细纲-第012章",
      content: eventOutlineContent,
    })).toMatchObject({
      fileType: "event-outline",
      targetFolder: "事件细纲",
    })
  })

  /*
   * 这条原先钉的是「hint 里出现『事件细纲』就判成 event-outline」。**故意反转**。
   *
   * 原因：hint 装的是对话文本（collectOutlineSaveSourceHint 收的是意图原话、
   * 意图标题、最后一条用户消息、会话标题），而事件细纲向导发的那条可见用户消息
   * 内容就是「生成第N章事件细纲（N 个事件）」—— 它会**永久**留在这个会话的 hint 里。
   * 于是同一会话里后出的任何交付物（「# 全书总纲」「# 世界观设定」），
   * 只要标题与首个 H1 没有章/卷/细纲字样，就会被 hint 判成 event-outline：
   * 被自动通道的闸门静默丢弃，手动通道更会把它归进 wiki/outlines/事件细纲/。
   *
   * 而「事件细纲」在本批之后根本不是可保存类型，用对话措辞去路由它没有任何收益，
   * 只有上面这个副作用。所以 event-outline 不再由 hint 判定；
   * 这份 fixture 现在落到 :113 的兜底 "outline"（正文无章/卷/细纲线索）。
   *
   * 真正的细纲识别能力一点没丢：它由**文档自身**在一级判据上完成
   * （下面 :190 与 :208 两条钉的就是那个通道），正文那一层也仍然认事件标记。
   */
  /*
   * ⚠ 残留风险（本批未修，已上报）：落到的是 chapter-outline，**不是**兜底的 outline。
   *
   * 原因是那条向导消息里除了「事件细纲」还带着「第12章」：摘掉事件标记后剩
   * 「生成第12章」，而 resolveChapterOrVolumeType 认 `第\d+章`，于是 hint 这一层
   * 仍然会把文档定型。也就是说 FIX 1 消除了「被判成事件细纲 → 被闸门静默丢弃 /
   * 归进 wiki/outlines/事件细纲/」这条最严重的后果，但**对话措辞参与定类型**
   * 这个根因只修了一半：同一会话里后出的「# 全书总纲」现在会落到 章纲/。
   *
   * 这条断言因此钉的是**真实行为**而不是期望行为 —— 若后续把 hint 层整体
   * 降级为「只补人物/伏笔/设定这类非章节线索」，本断言应当改成 outline。
   */
  it("hint 里出现「事件细纲」不再把文档判成事件细纲（对话措辞不参与定类型）", () => {
    expect(classifyOutlineSaveTarget({
      title: "令牌初现",
      content: "## 院子里的哭声\n- 念念挨了打",
      sourceHint: "生成第12章事件细纲",
    })).toMatchObject({
      fileType: "chapter-outline",
      targetFolder: "章纲",
    })
  })

  it("hint 里的「事件细纲」不再指向事件细纲文件夹", () => {
    // 丙-1 的要害：绝不能落到 wiki/outlines/事件细纲/
    const result = classifyOutlineSaveTarget({
      title: "令牌初现",
      content: "## 院子里的哭声\n- 念念挨了打",
      sourceHint: "生成第12章事件细纲",
    })
    expect(result.fileType).not.toBe("event-outline")
    expect(result.targetFolder).not.toBe("事件细纲")
  })

  /*
   * FIX 1 的直接回归：事件细纲会话里后出的无关交付物，不能被那条向导消息带偏。
   * 这是「靠正文分类」那条腿在真实会话里的样子（hint 已被污染，文档本身与细纲无关）。
   */
  it.each([
    ["# 全书总纲", "## 故事一句话\n这是一个关于复仇的故事。"],
    ["# 世界观设定", "## 力量体系\n斗气分九段。"],
    ["# 人物关系总览", "## 主角团\n楚白与骆轻竹是同门。"],
  ])("事件细纲会话里后出的「%s」不会因 hint 被判成事件细纲", (title, content) => {
    expect(classifyOutlineSaveTarget({
      title,
      content,
      sourceHint: "生成第12章事件细纲（6 个事件）\n事件细纲",
    }).fileType).not.toBe("event-outline")
  })

  it("正文只出现「事件序列」而没有「细纲」二字时也判为事件细纲", () => {
    expect(classifyOutlineSaveTarget({
      title: "令牌初现",
      content: "## 事件序列\n1. 院子里的哭声\n2. 夜壶里的药",
    })).toMatchObject({
      fileType: "event-outline",
      targetFolder: "事件细纲",
    })
  })

  it("没有「事件」标记的「章纲」仍然指 17 节章纲，不被新标记劫持", () => {
    expect(classifyOutlineSaveTarget({
      title: "第12章章纲",
      content: "## 本章目标\n- 拾得残碑",
    })).toMatchObject({
      fileType: "chapter-outline",
      targetFolder: "章纲",
    })
  })

  it("事件细纲的文件名按章号补零，而不是照抄标题", () => {
    // 标题不带「事件细纲-」前缀时，只有事件细纲专属的命名分支才会给出规范名（否则退化成「令牌初现.md」）
    expect(classifyOutlineSaveTarget({
      explicitFileType: "event-outline",
      title: "令牌初现",
      content: eventOutlineContent,
    })).toMatchObject({
      fileType: "event-outline",
      fileName: "事件细纲-第012章.md",
    })
  })

  it("提示词规定的自识别形状（# 事件细纲 · 第N章）不被「第12章」抢成章纲", () => {
    // 这条是 C2 的回归：文档自己带「事件细纲」后，即便标题/正文里同时出现「第12章」，
    // 也必须走事件细纲，绝不能靠调整推断链顺序来修（那会劫持合法的 17 节章纲）。
    expect(classifyOutlineSaveTarget({
      title: "第12章 · 令牌初现",
      content: [
        "# 事件细纲 · 第12章 令牌初现",
        "",
        "## 事件1 院子里的哭声",
        "- 关键台词：「夜壶里的东西是药。」",
        "- 神情动作：念念两只小手护住屁股蛋。",
      ].join("\n"),
    })).toMatchObject({
      fileType: "event-outline",
      targetFolder: "事件细纲",
    })
  })

  it("仅标题带「事件细纲 · 第N章」、正文很泛时也走事件细纲", () => {
    expect(classifyOutlineSaveTarget({
      title: "事件细纲 · 第12章 令牌初现",
      content: "## 院子里的哭声\n- 念念挨了打",
    })).toMatchObject({
      fileType: "event-outline",
      targetFolder: "事件细纲",
    })
  })

  it("正文提到「本章事件序列」的 17 节章纲仍然是章纲，不被事件标记劫持", () => {
    // 反向守卫：修 C2 时绝不能把「事件」类检查提到 subject 之前 ——
    // 那样一份合法章纲会因为第 5 节叫「本章事件序列」而被改判成事件细纲。
    const seventeenSectionChapterOutline = [
      "# 章纲-第46章：第一次冷处理",
      "",
      "## 1. 本章定位",
      "- 承接第45章的摊牌余波。",
      "## 2. 上层依据",
      "- cause: 上级要一个交代",
      "- action: 把男主踢出核心组",
      "- result: 男主第一次被冷处理",
      "- use: 铺垫离职线",
      "## 5. 本章事件序列",
      "- 早会被点名、工位被挪、群聊被移出",
      "## 17. 章尾钩子",
      "- 男主收到一条陌生短信。",
    ].join("\n")
    expect(classifyOutlineSaveTarget({
      title: "章纲-第046章：第一次冷处理",
      content: seventeenSectionChapterOutline,
    })).toMatchObject({
      fileType: "chapter-outline",
      targetFolder: "章纲",
    })
  })
})

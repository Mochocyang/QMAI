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
   * 只有上面这个副作用。所以 event-outline 不再由 hint 判定。
   *
   * ⚠️ 只摘掉事件标记还**不够**：向导那条消息里还剩「第12章」，而
   * `CHAPTER_SUBJECT` 的裸章号兜底 `/第\s*\d{1,4}\s*章/` 只凭这个残句就会把
   * 文档定型成 chapter-outline（文件名退化成「令牌初现.md」+ 默认落 `章纲/`）。
   * 所以 `inferFileTypeFromHint` 里另有一道窄门 `CHAPTER_OR_VOLUME_HINT_MARK`：
   * 只有 hint 自己明说了章纲/卷纲这一族的词，才允许它参与章/卷定型。
   * 本 fixture 的 hint 摘掉事件标记后既无「章纲」也无「卷纲」，不命中窄门 ⇒ 继续下沉，
   * 由文档自身（`## 院子里的哭声` / `- 念念挨了打` 无任何类型线索）走到兜底的
   * `outline`。断言因此钉的是**期望行为**：对话措辞不参与定类型。
   *
   * 真正的细纲识别能力一点没丢：它由**文档自身**在一级判据上完成
   * （本文件下一条与「提示词规定的自识别形状」两条钉的就是那个通道），
   * 正文那一层（inferFileTypeFromContent）也仍然认事件标记。
   */
  it("hint 里出现「事件细纲」不再把文档判成事件细纲（对话措辞不参与定类型）", () => {
    expect(classifyOutlineSaveTarget({
      title: "令牌初现",
      content: "## 院子里的哭声\n- 念念挨了打",
      sourceHint: "生成第12章事件细纲",
    })).toMatchObject({
      fileType: "outline",
      targetFolder: "大纲",
    })
  })

  /*
   * FIX 1 的直接回归：事件细纲会话里后出的无关交付物，不能被那条向导消息带偏。
   * 这是「靠正文/标题分类」那条腿在真实会话里的样子（hint 已被污染，文档本身与细纲无关）。
   *
   * 期望值逐条按**实际分类通道**给，而不是只断言 `not.toBe("event-outline")`：
   * 后者对「落到 章纲/」这种半修复状态同样通过，正是 FIX 1 只修一半时发生过的事。
   * - 「# 全书总纲」→ inferFileTypeFromHint(标题) 命中 /故事大纲|总纲/ → outline
   * - 「# 世界观设定」→ 命中 /世界观/ → setting
   * - 「# 人物关系总览」→ 三条通道都推不出更具体的类型 → inferFileTypeFromContent 兜底 outline
   */
  it.each([
    ["# 全书总纲", "## 故事一句话\n这是一个关于复仇的故事。", "outline", "大纲"],
    ["# 世界观设定", "## 力量体系\n斗气分九段。", "setting", "设定"],
    ["# 人物关系总览", "## 主角团\n楚白与骆轻竹是同门。", "outline", "大纲"],
  ])("事件细纲会话里后出的「%s」不会因 hint 被判成事件细纲", (title, content, fileType, targetFolder) => {
    expect(classifyOutlineSaveTarget({
      title,
      content,
      sourceHint: "生成第12章事件细纲（6 个事件）\n事件细纲",
    })).toMatchObject({ fileType, targetFolder })
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

  /*
   * ⚠️ 这条钉的是**真实行为**而不是期望行为，别把它读成「设计想要这样」：
   *
   * `inferFileTypeFromContent` 里事件标记的判定**排在章/卷标记之前**（有意为之，
   * 见该常量的注释），所以一份标题里没有「章纲」二字、正文却提到「本章事件序列」的
   * 17 节章纲会被判成 event-outline —— 随后被大纲面板的手动闸门拒掉。
   *
   * 现实中合法章纲之所以不被误拦，**只有一条**保护：canonical 的章纲模板里根本没有
   * 事件标记（chapter-outline-template.ts 里 grep 不到「事件细纲/事件清单/事件序列」），
   * 于是事件标记判定不命中，落到章/卷判定。即**当前模板的巧合**，不是结构性保证。
   *
   * ⚠️ 订正一处曾经的误述：这里**不是**「标题 hint 先于正文」。分类链
   * （outline-save-classifier.ts:187-194）里 `inferFileTypeFromHint(title)`
   * 是**第 5** 条通道；真正给标题带「章纲」的文档定型的是**第 3** 条
   * `resolveChapterOrVolumeType(extractDocumentSubject(title, content))`
   * （它把标题与首个 H1 一起看）。而本用例的 fixture 标题是「第一次冷处理」：
   * `inferFileTypeFromHint(title)` 对它返回 null，第 3 条的 extractDocumentSubject
   * 也推不出章纲 —— 所以本例只有「模板里没有事件标记」这一条保护在起作用。
   *
   * 这条用例把「巧合」变成「有人改优先级就会红」：
   * 若哪天把章/卷标记提到事件标记之前，本用例立刻失败，提醒去读上面这段原因。
   */
  it("反向钉住真实优先级：正文里带事件标记的章纲会被判成事件细纲（已知假阳性路径）", () => {
    const seventeenSectionWithEventSection = [
      "# 第一次冷处理",
      "",
      "## 1. 本章定位",
      "- 承接第45章的摊牌余波。",
      "## 5. 本章事件序列",
      "- 早会被点名、工位被挪、群聊被移出",
      "## 17. 章尾钩子",
      "- 男主收到一条陌生短信。",
    ].join("\n")
    expect(classifyOutlineSaveTarget({
      title: "第一次冷处理",
      content: seventeenSectionWithEventSection,
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

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

  it("用户原话是「事件细纲」时同样走事件细纲", () => {
    expect(classifyOutlineSaveTarget({
      title: "令牌初现",
      content: "## 院子里的哭声\n- 念念挨了打",
      sourceHint: "生成第12章事件细纲",
    })).toMatchObject({
      fileType: "event-outline",
      targetFolder: "事件细纲",
    })
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
})

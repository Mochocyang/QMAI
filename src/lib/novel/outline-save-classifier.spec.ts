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
})

/**
 * 结构化数据 → Markdown/HTML 的端到端不变量（四条结构化-only 产线）。
 *
 * 为什么需要这组用例：模型不再手写 MD 之后，落盘的 .md 完全由 `render*Markdown` 产生。
 * 一旦反推漏字段、夹带 JSON 符号、或被空值刷出噪声，**文件照样生成成功**，
 * 没有任何界面会报错 —— 只能靠这里的端到端断言守住：
 *
 * 1. 一个字段不能丢（表格：行比表头宽、只有 rows 没有 head 都要活下来）；
 * 2. 不许出现 ``` / `"key":` 这类数据形态；
 * 3. 不许出现「未填」「未定」这类占位噪声，也不许成串空行；
 * 4. 反推的 MD 必须能被 `profileDocumentFromMarkdown` 解析回来（名字/徽章/分区数不漂）；
 * 5. 一条回复里出现多卷时，各保存请求拿各的正文（不能都写第一卷）。
 */
import { describe, expect, it } from "vitest"
import { parseOutlineSaveRequests } from "./outline-save-request"
import { SETTING_PROFILE_SECTIONS, type SettingProfileKey } from "./setting-profile-contracts"
import { profileDocumentFromMarkdown } from "./profile-document"

const OUTPUTS: Record<SettingProfileKey, { single: string; list: string; fileType: string; fileName: string; folder: string }> = {
  characterBriefs: { single: "characterProfileData", list: "characterProfiles", fileType: "character", fileName: "角色-楚白.md", folder: "人物小传" },
  organizationsOutline: { single: "factionProfileData", list: "factionProfiles", fileType: "organization", fileName: "青云会.md", folder: "组织" },
  powerSystem: { single: "powerProfileData", list: "powerProfiles", fileType: "setting", fileName: "九转玄功.md", folder: "设定" },
  goldenFinger: { single: "goldenFingerProfileData", list: "goldenFingerProfiles", fileType: "setting", fileName: "签到系统.md", folder: "设定" },
  backgroundSetting: { single: "backgroundProfileData", list: "backgroundProfiles", fileType: "setting", fileName: "北境背景.md", folder: "设定" },
  geographySetting: { single: "geographyProfileData", list: "geographyProfiles", fileType: "setting", fileName: "北境地理.md", folder: "设定" },
  foreshadowingPlan: { single: "foreshadowingProfileData", list: "foreshadowingProfiles", fileType: "foreshadowing", fileName: "竹哨.md", folder: "伏笔" },
  locationsOutline: { single: "locationProfileData", list: "locationProfiles", fileType: "setting", fileName: "竹屋.md", folder: "设定" },
}

function buildSections(key: SettingProfileKey) {
  return SETTING_PROFILE_SECTIONS[key].map((spec, index) => {
    if (spec.kind === "table") {
      return {
        kind: "table",
        heading: spec.heading,
        head: spec.head,
        rows: [spec.head!.map((_, cell) => `CELL_${index}_${cell}_值`)],
      }
    }
    if (spec.kind === "list") {
      return { kind: "list", heading: spec.heading, items: [`ITEM_${index}_值`] }
    }
    return { kind: "kv", heading: spec.heading, items: [{ label: `LBL_${index}`, text: `TEXT_${index}_值` }] }
  })
}

function buildReply(key: SettingProfileKey, name = "对象名") {
  const output = OUTPUTS[key]
  const data = { name, tag: "类型徽章", tagline: "一句话定位", sections: buildSections(key) }
  const request = {
    targetFolder: output.folder,
    fileName: output.fileName,
    fileType: output.fileType,
    writeMode: "create",
    referencedSkills: [],
    sourceIntent: "审计",
    content: "",
  }
  return [
    "已生成，正文由软件从结构化数据生成。",
    "",
    "```json",
    JSON.stringify({ [output.single]: data }, null, 2),
    "```",
    "",
    "```json",
    JSON.stringify({ outlineSaveRequest: request }),
    "```",
  ].join("\n")
}

function collectSentinels(key: SettingProfileKey): string[] {
  const sections = buildSections(key)
  const values: string[] = []
  for (const section of sections) {
    if (section.kind === "table") values.push(...section.rows[0])
    if (section.kind === "list") values.push(...section.items)
    if (section.kind === "kv") values.push(...section.items.map((item) => item.text))
  }
  return values
}

describe("八类设定：JSON → MD 端到端", () => {
  for (const key of Object.keys(OUTPUTS) as SettingProfileKey[]) {
    it(`${key} 正文完整、无 JSON 符号、无占位噪声`, () => {
      const reply = buildReply(key)
      const result = parseOutlineSaveRequests(reply)
      expect(result.errors, `${key} errors: ${result.errors.join(" | ")}`).toEqual([])
      expect(result.requests).toHaveLength(1)
      const content = result.requests[0].content
      // 1. 字段一个不丢
      const missing = collectSentinels(key).filter((value) => !content.includes(value.replace(/\|/g, "\\|")))
      expect(missing, `${key} 丢失字段: ${missing.slice(0, 5).join(",")}`).toEqual([])
      // 2. 不带 JSON 符号
      expect(content).not.toContain("```")
      expect(content).not.toContain('":')
      expect(content).not.toContain('{"')
      // 3. 不出现占位噪声
      expect(content).not.toContain("未填")
      expect(content).not.toContain("未定")
      // 4. 空行不成串
      expect(content).not.toMatch(/\n{3,}/)
      // 5. HTML 也渲染出来了
      expect(result.requests[0].htmlContent ?? "").toContain("<html")
      // 6. 反推的 MD 能被解析回来（名字/徽章/分区数不漂）
      const parsed = profileDocumentFromMarkdown(content)
      expect(parsed?.name).toBe("对象名")
      expect(parsed?.tag).toBe("类型徽章")
      expect(parsed?.sections.length).toBe(SETTING_PROFILE_SECTIONS[key].length)
    })
  }
})

describe("八类设定：表格容错", () => {
  it("行比表头宽时不得丢列", () => {
    const reply = [
      "```json",
      JSON.stringify({
        factionProfileData: {
          name: "青云会",
          sections: [
            { kind: "table", heading: "组织架构", head: ["职位", "人数"], rows: [["会长", "1", "EXTRA_列_值"]] },
          ],
        },
      }),
      "```",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "组织", fileName: "青云会.md", fileType: "organization",
          writeMode: "create", referencedSkills: [], sourceIntent: "", content: "",
        },
      }),
      "```",
    ].join("\n")
    const result = parseOutlineSaveRequests(reply)
    expect(result.errors).toEqual([])
    expect(result.requests[0].content).toContain("EXTRA_列_值")
  })

  it("只有 rows 没有 head 时不得丢整表内容", () => {
    const reply = [
      "```json",
      JSON.stringify({
        factionProfileData: {
          name: "青云会",
          sections: [{ kind: "table", heading: "人员构成", rows: [["会长", "NOH_HEAD_值"]] }],
        },
      }),
      "```",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "组织", fileName: "青云会.md", fileType: "organization",
          writeMode: "create", referencedSkills: [], sourceIntent: "", content: "",
        },
      }),
      "```",
    ].join("\n")
    const result = parseOutlineSaveRequests(reply)
    expect(result.errors).toEqual([])
    expect(result.requests[0].content).toContain("NOH_HEAD_值")
    expect(result.requests[0].content).not.toMatch(/\|\s*\|\s*\|/)
  })

  it("名字里已带括号时，徽章不得重复", () => {
    const reply = [
      "```json",
      JSON.stringify({
        characterProfileData: {
          name: "楚白（主角）",
          tag: "主角",
          sections: [{ kind: "kv", heading: "基本信息", items: [{ label: "姓名", text: "楚白" }] }],
        },
      }),
      "```",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "人物小传", fileName: "角色-楚白.md", fileType: "character",
          writeMode: "create", referencedSkills: [], sourceIntent: "", content: "",
        },
      }),
      "```",
    ].join("\n")
    const result = parseOutlineSaveRequests(reply)
    expect(result.errors).toEqual([])
    expect(result.requests[0].content.split("\n")[0]).toBe("# 楚白（主角）")
  })
})

describe("卷纲 / 章纲 / 事件细纲", () => {
  const stageIds = ["起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②"]
  const volumeData = {
    title: "卷一 雨夜无我",
    goal: "把编号变成名字",
    stories: Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      range: `第 ${i * 12 + 1}–${i * 12 + 12} 章`,
      title: `故事${i + 1}`,
      beats: "平升起紧落缓升紧顶缓顶悬",
      st: stageIds.map((stage, index) => ({
        stage,
        label: `LBL_${i}_${index}`,
        who: `WHO_${i}_${index}`,
        p: [`P_${i}_${index}_0`, `P_${i}_${index}_1`, `P_${i}_${index}_2`],
      })),
    })),
  }

  it("卷纲：故事/环节/条目全部落到 MD，且不带台账", () => {
    const reply = [
      "```json",
      JSON.stringify({ volumeOutlineData: volumeData }),
      "```",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "卷纲", fileName: "卷纲-第一卷.md", fileType: "volume-outline",
          writeMode: "create", referencedSkills: [], sourceIntent: "", content: "",
        },
      }),
      "```",
    ].join("\n")
    const result = parseOutlineSaveRequests(reply)
    expect(result.errors).toEqual([])
    const content = result.requests[0].content
    expect(content).toContain("# 卷一 雨夜无我")
    expect(content).toContain("> 把编号变成名字")
    for (const story of volumeData.stories) {
      expect(content).toContain(`## 故事${story.id}：${story.title}`)
      expect(content).toContain(story.range)
      expect(content).toContain(story.beats)
      for (const stage of story.st) {
        expect(content).toContain(stage.label)
        expect(content).toContain(stage.who)
        for (const point of stage.p) expect(content).toContain(point)
      }
    }
    expect(content).not.toContain("```")
    expect(content).not.toContain("未定")
  })

  it("章纲：17 节全部落到 MD，没有占位噪声", () => {
    const chapter = {
      n: 1, title: "竹哨与雨夜", stage: "起①", beat: "平", expect: "好奇",
      time: "第一日 傍晚", place: "竹林", seedFores: "SEED_伏笔名", payFores: "PAY_伏笔名",
      info: { attr: "铺垫章", mood: "悬念", words: "约 2500 字", goal: "GOAL_值" },
      carry: { hook: "HOOK_值", left: "LEFT_值", heroState: "HERO_值", castState: "CAST_值", fores: "FORES_值", expect: "CEXP_值" },
      position: { main: "MAIN_值", advance: "ADV_值", charArc: "ARC_值", relation: "REL_值", whyRead: "WHY_值", newExpect: "NEW_值" },
      digest: "DIGEST_值",
      events: [{ what: "WHAT_值", cause: "CAUSE_值", action: "ACTION_值", result: "RESULT_值", use: "USE_值" }],
      keywords: { scene: "SCENE_值", mood: "MOOD_值", props: "PROPS_值", relation: "KREL_值", sell: "SELL_值" },
      conditions: { enter: "ENTER_值", trigger: "TRIGGER_值", interact: "INTERACT_值", result: "CRESULT_值" },
      fourBeat: { open: "OPEN_值", clash: "CLASH_值", burst: "BURST_值", close: "CLOSE_值" },
      moodCurve: [{ node: "NODE_值", state: "STATE_值", trigger: "CTRIG_值", feel: "FEEL_值" }],
      sell: { first: "FIRST_值", main: "SMAIN_值", build: "BUILD_值", release: "RELEASE_值", react: "REACT_值", after: "AFTER_值", fit: "FIT_值" },
      expand: [{ info: "EINFO_值", how: "EHOW_值", skill: "ESKILL_值", effect: "EEFFECT_值" }],
      visual: { env: "ENV_值", micro: "MICRO_值", hint: "HINT_值", replace: "REPLACE_值", memory: "MEMORY_值" },
      foreshadow: {
        payFrom: "PAYFROM_值", payHow: "PAYHOW_值", payLevel: "PAYLEVEL_值",
        seedNew: "SEEDNEW_值", seedAt: "SEEDAT_值", seedUse: "SEEDUSE_值",
        hookType: "HOOKTYPE_值", readerAsk: "READERASK_值", nextMust: "NEXTMUST_值",
      },
      castChanges: [{ who: "WHO_值", role: "ROLE_值", inState: "IN_值", outState: "OUT_值", relation: "CREL_值" }],
      worldUpdate: { setting: "WSET_值", place: "WPLACE_值", faction: "WFAC_值", item: "WITEM_值", writeBack: "WRITE_值" },
      rules: { must: "MUST_值", forbid: "FORBID_值", secret: "SECRET_值", pace: "PACE_值", style: "STYLE_值", sellPoint: "SELLPOINT_值" },
      handover: { nextStart: "NEXTSTART_值", nextSolve: "NEXTSOLVE_值", nextDelay: "NEXTDELAY_值", nextMood: "NEXTMOOD_值", nextHook: "NEXTHOOK_值" },
      checks: ["三行内入戏", "有明确变化", "事件链有因果", "有核心记忆点", "有动作微细节", "有爽点", "回收旧信息", "埋新信息", "有追读钩子", "已写明下一章交接"],
    }
    const reply = [
      "```json",
      JSON.stringify({ chapterOutlineData: { title: "故事一 章纲", story: { index: 1, name: "故事一", range: "第1–1章", beats: "平" }, words: 2500, chapters: [chapter] } }),
      "```",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "章纲", fileName: "章纲-第01–01章.md", fileType: "chapter-outline",
          writeMode: "create", referencedSkills: [], sourceIntent: "", content: "",
        },
      }),
      "```",
    ].join("\n")
    const result = parseOutlineSaveRequests(reply)
    expect(result.errors).toEqual([])
    const content = result.requests[0].content
    const sentinels = content.match(/_值|SEED_伏笔名|PAY_伏笔名/g) ?? []
    expect(sentinels.length).toBeGreaterThan(40)
    // 具体抽查几个最容易漏的
    for (const token of ["MAIN_值", "NEXTMUST_值", "SEEDNEW_值", "WRITE_值", "SELLPOINT_值", "SEED_伏笔名", "PAY_伏笔名"]) {
      expect(content, token).toContain(token)
    }
    expect(content).not.toContain("未填")
    expect(content).not.toContain("```")
    expect(content).not.toMatch(/\n{3,}/)
  })

  it("一条回复里两卷时，各自拿到自己的正文与折叠树", () => {
    const second = {
      ...volumeData,
      title: "卷二 千碑之城",
      goal: "把名字还回去",
      stories: volumeData.stories.map((story) => ({
        ...story,
        range: `第 ${story.id * 12 + 120}–${story.id * 12 + 131} 章`,
        title: `卷二故事${story.id}`,
      })),
    }
    const saveRequest = (fileName: string) => JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "卷纲", fileName, fileType: "volume-outline",
        writeMode: "create", referencedSkills: [], sourceIntent: "", content: "",
      },
    })
    const reply = [
      "```json", JSON.stringify({ volumeOutlineData: volumeData }), "```",
      "```json", saveRequest("卷纲-第一卷.md"), "```",
      "```json", JSON.stringify({ volumeOutlineData: second }), "```",
      "```json", saveRequest("卷纲-第二卷.md"), "```",
    ].join("\n")
    const result = parseOutlineSaveRequests(reply)
    expect(result.errors).toEqual([])
    const firstFile = result.requests.find((item) => item.fileName.includes("第一卷"))
    const secondFile = result.requests.find((item) => item.fileName.includes("第二卷"))
    expect(firstFile?.content).toContain("# 卷一 雨夜无我")
    expect(firstFile?.content).not.toContain("卷二 千碑之城")
    expect(secondFile?.content).toContain("# 卷二 千碑之城")
    expect(secondFile?.content).toContain("卷二故事1")
  })
})

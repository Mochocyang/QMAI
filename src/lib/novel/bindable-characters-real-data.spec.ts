import { describe, expect, it } from "vitest"

import { filterBindableCharacters, isLikelyNonCharacterName } from "./bindable-characters-filter"

/**
 * 用用户真实项目的数据钉住过滤规则的两端：
 * 一端是用户明确嫌吵的垃圾名必须被拦下，另一端是真实人名一个都不能被误杀。
 *
 * 与 docs/soul-binding-perf-20261006/verify-real-data.mjs 的区别：
 * 那个脚本是把规则用正则从源码里抠出来再本地重写一遍，规则改了它可能照样通过；
 * 这里直接调用发布出去的那个谓词，所以它是一条真正的回归防线。
 *
 * 数据来源：用户截图里的条目、D:\QM-BOOK\他，只想活着\QM\entities 的真实实体页名，
 * 以及该作品大纲里的真实标题。
 */
describe("人名过滤用真实项目数据校验", () => {
  /** 用户截图里出现、明确不该出现在绑定列表里的条目。 */
  const JUNK_FROM_SCREENSHOT = [
    "编号派通用手段",
    "编号体执行群",
    "成长或崩坏路径",
    "冲突点",
    "当前状态",
  ]

  /** 用户截图里出现、必须保留的真实人名／角色称呼（含非姓名的角色身份）。 */
  const REAL_NAMES_FROM_SCREENSHOT = [
    "城中百姓",
    "城中兵士",
    "城中老人",
    "城中孩童",
    "城防统领",
    "采药老人",
    "陈十七",
    "白依",
    "阿禾",
    "阿七",
  ]

  /** 用户真实项目 wiki/entities 下的实体页名（39 个）。 */
  const REAL_ENTITIES = [
    "095男孩", "临水镇", "临水镇停云庄", "回收者", "回收者092", "回收者094", "回收者095",
    "回收者组织", "大林村南废墙", "姑姑", "宿泽镇", "宿泽镇义庄", "密道", "岔路口", "布偶",
    "布偶防御力量", "废弃矿道", "归元箓", "杨妙萍", "杨寒", "林子", "林小晚", "林小满",
    "林秀云", "枯枝", "横道", "水碗", "洞口", "灌木丛", "石头", "石室", "窄沟", "纸条",
    "荒地", "采药老人", "铁门", "镰刀", "陶碗", "黑塔",
  ]

  /** 该作品大纲里的真实标题。 */
  const REAL_OUTLINE_TITLES = ["陈玄", "赵无极一脉残部", "魔教七杀堂小队", "核心家庭线", "敌对压迫线"]

  // 三个来源有重叠（如「采药老人」「许七安」），去重后再作为整体比较，
  // 免得把「测试数据里自己重复」误判成过滤规则出错。
  const ALL_REAL = [...new Set([...REAL_NAMES_FROM_SCREENSHOT, ...REAL_ENTITIES, ...REAL_OUTLINE_TITLES])]

  it("用户点名嫌吵的条目全部被拦下", () => {
    const survived = JUNK_FROM_SCREENSHOT.filter((name) => !isLikelyNonCharacterName(name))
    expect(survived, "这些是用户明确要求过滤掉的条目").toEqual([])
  })

  it("更多真实的垃圾名形态也被拦下（含用户可能没说出口的）", () => {
    const junk = [
      "用途说明", "关键任务卡", "一句话总结", "人物关系图", "写作进度",
      "第一卷总览", "人物当前状态", "编号派通用手段",
    ]
    expect(junk.filter((name) => !isLikelyNonCharacterName(name))).toEqual([])
  })

  it("真实人名与角色称呼一个都不能被误杀", () => {
    const killed = ALL_REAL.filter((name) => isLikelyNonCharacterName(name))
    expect(killed, "误杀真实名字会让用户根本绑不上这些角色").toEqual([])
  })

  it("filterBindableCharacters 对真实数据：垃圾名被剔除、真实名字原样保留且顺序不变", () => {
    const input = [...ALL_REAL, ...JUNK_FROM_SCREENSHOT]
    const result = filterBindableCharacters(input, [])

    expect(result).toEqual(ALL_REAL)
    for (const junk of JUNK_FROM_SCREENSHOT) expect(result).not.toContain(junk)
  })

  it("安全阀对真实数据同样生效：已绑定的垃圾名也不能被剔除", () => {
    const bound = ["冲突点"]
    const result = filterBindableCharacters(["许七安", "冲突点"], [], bound)
    // 「冲突点」命中规则，但用户已经把它绑上了，就绝不能让它从列表里消失
    expect(result).toContain("冲突点")
    expect(result).toContain("许七安")
  })

  it("空名字、纯空白、纯数字不被误判成垃圾（避免规则过宽）", () => {
    for (const name of ["", "   ", "092", "095男孩", "陈十七"]) {
      expect(isLikelyNonCharacterName(name), `${JSON.stringify(name)} 不该被判为垃圾`).toBe(false)
    }
  })
})

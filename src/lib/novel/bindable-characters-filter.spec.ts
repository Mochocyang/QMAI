import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BINDABLE_IGNORE_FILE,
  NON_CHARACTER_NAME_PATTERNS,
  addBindableIgnore,
  bindableIgnoreListPath,
  filterBindableCharacters,
  isLikelyNonCharacterName,
  readBindableIgnoreList,
  removeBindableIgnore,
} from "./bindable-characters-filter"

/**
 * fs 层沿用房内既有 mock 约定（见 book-analysis/workbench-publish.spec.ts）：
 * 用内存 Map 当磁盘，readFile 在文件缺失时抛错。
 */
const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: vi.fn(),
  dirs: [] as string[],
}))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error("文件缺失")
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, text: string) => {
    io.writes(path)
    io.files.set(path, text)
  },
  createDirectory: async (path: string) => {
    io.dirs.push(path)
  },
  fileExists: async (path: string) => io.files.has(path),
}))

const 项目路径 = "C:\\QMAI_C\\测试作品"
const 忽略表路径 = "C:/QMAI_C/测试作品/.qmai/bindable-characters-ignore.json"

/** 每条强特征规则配一个专属样例：某条规则被删掉时，只有它对应的样例会失败。 */
const 强特征样例: ReadonlyArray<[string, string]> = [
  ["精确匹配·用途说明", "用途说明"],
  ["精确匹配·关键任务卡", "关键任务卡"],
  ["精确匹配·一句话总结", "一句话总结"],
  ["精确匹配·冲突点", "冲突点"],
  ["精确匹配·当前状态", "当前状态"],
  ["后缀·通用手段", "编号派通用手段"],
  ["后缀·执行群", "编号体执行群"],
  ["后缀·坏路径", "成长或崩坏路径"],
  ["后缀·总览", "第一卷总览"],
  ["后缀·关系图", "人物关系图"],
  ["后缀·当前状态", "人物当前状态"],
  ["后缀·进度", "写作进度"],
]

/** 真实人物名回归防线：这批名字一个都不许被规则误杀。 */
const 真实人名 = [
  "城中百姓",
  "城中兵士",
  "城中老人",
  "城中孩童",
  "采药老人",
  "许七安",
  "林小满",
  "杨妙萍",
  "杨寒",
  "阿禾",
  "阿七",
  "白依",
  "陈十七",
  "城防统领",
]

describe("非角色名强特征规则", () => {
  it("样例清单规模固定（避免 it.each 悄悄跑 0 例而假装通过）", () => {
    expect(强特征样例).toHaveLength(12)
    expect(真实人名).toHaveLength(14)
  })

  it("规则表覆盖全部强特征且不缩水", () => {
    expect(NON_CHARACTER_NAME_PATTERNS.length).toBeGreaterThanOrEqual(12)
  })

  it("每条规则都至少被一个样例命中（避免规则形同虚设）", () => {
    const 样例集 = 强特征样例.map(([, 样例]) => 样例)
    const 未被覆盖 = NON_CHARACTER_NAME_PATTERNS.filter(
      (规则) => !样例集.some((样例) => 规则.test(样例)),
    )
    expect(未被覆盖.map((规则) => 规则.source)).toEqual([])
  })

  it.each(强特征样例)("强特征命中：%s", (_规则名, 样例) => {
    expect(isLikelyNonCharacterName(样例)).toBe(true)
  })

  it.each(真实人名)("真实人名不被误杀：%s", (人名) => {
    expect(isLikelyNonCharacterName(人名)).toBe(false)
  })

  it.each(["", " ", "   ", "\t", "\n  "])("空白输入一律返回 false：%j", (输入) => {
    expect(isLikelyNonCharacterName(输入)).toBe(false)
  })

  it("名字首尾空白不影响判定", () => {
    expect(isLikelyNonCharacterName("  冲突点  ")).toBe(true)
    expect(isLikelyNonCharacterName("  许七安  ")).toBe(false)
  })
})

describe("可绑定忽略表读写", () => {
  beforeEach(() => {
    io.files.clear()
    io.dirs.length = 0
    vi.clearAllMocks()
  })

  it("文件名与落盘路径固定为 .qmai/bindable-characters-ignore.json", () => {
    expect(BINDABLE_IGNORE_FILE).toBe("bindable-characters-ignore.json")
    expect(bindableIgnoreListPath(项目路径)).toBe(忽略表路径)
  })

  it("文件缺失时返回空数组，不抛错", async () => {
    await expect(readBindableIgnoreList(项目路径)).resolves.toEqual([])
  })

  it("JSON 损坏时返回空数组", async () => {
    io.files.set(忽略表路径, "{ 这不是 JSON")
    await expect(readBindableIgnoreList(项目路径)).resolves.toEqual([])
  })

  it.each([
    ["对象", '{"a":1}'],
    ["字符串", '"甲"'],
    ["数字", "123"],
    ["null", "null"],
  ])("顶层不是数组时返回空数组：%s", async (_标签, 原文) => {
    io.files.set(忽略表路径, 原文)
    await expect(readBindableIgnoreList(项目路径)).resolves.toEqual([])
  })

  it("数组里没有字符串时返回空数组", async () => {
    io.files.set(忽略表路径, JSON.stringify([1, 2, 3]))
    await expect(readBindableIgnoreList(项目路径)).resolves.toEqual([])
  })

  it("读回时清洗：只保留非空字符串、去重、保序", async () => {
    io.files.set(忽略表路径, JSON.stringify([" 甲 ", "", "乙", "甲", 42, null, "   ", "丙"]))
    await expect(readBindableIgnoreList(项目路径)).resolves.toEqual(["甲", "乙", "丙"])
  })

  it("add 补建 .qmai 目录、写盘并返回新列表", async () => {
    await expect(addBindableIgnore(项目路径, "甲")).resolves.toEqual(["甲"])
    expect(io.dirs).toContain("C:/QMAI_C/测试作品/.qmai")
    expect(JSON.parse(io.files.get(忽略表路径)!)).toEqual(["甲"])
  })

  it("重复 add 幂等，不产生重复项", async () => {
    await addBindableIgnore(项目路径, "甲")
    await addBindableIgnore(项目路径, "甲")
    await expect(addBindableIgnore(项目路径, "乙")).resolves.toEqual(["甲", "乙"])
    expect(JSON.parse(io.files.get(忽略表路径)!)).toEqual(["甲", "乙"])
  })

  it("add 会 trim 输入，并与已有项按 trim 后比较", async () => {
    await addBindableIgnore(项目路径, "  甲  ")
    await expect(addBindableIgnore(项目路径, "甲")).resolves.toEqual(["甲"])
  })

  it("add 空白名字不会写入空条目", async () => {
    await addBindableIgnore(项目路径, "甲")
    await expect(addBindableIgnore(项目路径, "   ")).resolves.toEqual(["甲"])
  })

  it("remove 按 trim 后比较删除并持久化", async () => {
    io.files.set(忽略表路径, JSON.stringify(["甲", "乙"]))
    await expect(removeBindableIgnore(项目路径, " 甲 ")).resolves.toEqual(["乙"])
    expect(JSON.parse(io.files.get(忽略表路径)!)).toEqual(["乙"])
  })

  it("remove 不存在的名字不抛错，返回原列表", async () => {
    io.files.set(忽略表路径, JSON.stringify(["甲"]))
    await expect(removeBindableIgnore(项目路径, "丙")).resolves.toEqual(["甲"])
    expect(JSON.parse(io.files.get(忽略表路径)!)).toEqual(["甲"])
  })

  it("文件损坏时 add/remove 以空表为起点，不抛错", async () => {
    io.files.set(忽略表路径, "坏掉的 JSON")
    await expect(addBindableIgnore(项目路径, "甲")).resolves.toEqual(["甲"])
    io.files.set(忽略表路径, "坏掉的 JSON")
    await expect(removeBindableIgnore(项目路径, "甲")).resolves.toEqual([])
  })
})

describe("可绑定角色过滤", () => {
  it("命中规则的名字被过滤", () => {
    expect(filterBindableCharacters(["许七安", "人物关系图", "林小满", "冲突点"], [])).toEqual([
      "许七安",
      "林小满",
    ])
  })

  it("命中忽略表的名字被过滤", () => {
    expect(filterBindableCharacters(["许七安", "林小满", "杨妙萍"], ["林小满"])).toEqual([
      "许七安",
      "杨妙萍",
    ])
  })

  it("忽略表按 trim 后比较", () => {
    expect(filterBindableCharacters(["许七安", "林小满"], ["  林小满  "])).toEqual(["许七安"])
  })

  it("未命中的名字全部保留", () => {
    expect(filterBindableCharacters(真实人名, [])).toEqual([...真实人名])
  })

  it("保持输入顺序", () => {
    expect(filterBindableCharacters(["杨妙萍", "冲突点", "阿七", "许七安"], ["阿七"])).toEqual([
      "杨妙萍",
      "许七安",
    ])
  })

  it("按首次出现去重", () => {
    expect(filterBindableCharacters(["杨妙萍", "许七安", " 杨妙萍 ", "许七安"], [])).toEqual([
      "杨妙萍",
      "许七安",
    ])
  })

  it("输出名字去掉首尾空白，同一身份只保留一种写法", () => {
    expect(filterBindableCharacters(["  许七安  "], [])).toEqual(["许七安"])
  })

  it("空字符串与纯空白条目被丢弃", () => {
    expect(filterBindableCharacters(["许七安", "", "   ", "\t"], [])).toEqual(["许七安"])
  })

  it("空输入返回空数组", () => {
    expect(filterBindableCharacters([], [])).toEqual([])
  })

  it("安全阀：同时命中规则与忽略表的已绑定名字必须保留", () => {
    expect(
      filterBindableCharacters(["人物关系图", "许七安"], ["人物关系图"], ["人物关系图"]),
    ).toEqual(["人物关系图", "许七安"])
  })

  it("安全阀对纯规则命中同样生效", () => {
    expect(
      filterBindableCharacters(["人物关系图", "冲突点", "许七安"], [], ["人物关系图", "冲突点"]),
    ).toEqual(["人物关系图", "冲突点", "许七安"])
  })

  it("安全阀接受 Set，并按 trim 后比较", () => {
    expect(filterBindableCharacters(["人物关系图"], [], new Set(["  人物关系图  "]))).toEqual([
      "人物关系图",
    ])
  })

  it("安全阀里不存在的名字不影响其他条目", () => {
    expect(filterBindableCharacters(["许七安", "人物关系图"], [], ["无关名字"])).toEqual(["许七安"])
  })

  it("安全阀保留的重复名字也只出现一次", () => {
    expect(filterBindableCharacters(["人物关系图", "人物关系图"], [], ["人物关系图"])).toEqual([
      "人物关系图",
    ])
  })
})

/**
 * 表单三件套测试：归一化 / 初始值 / 校验。
 *
 * 守的是「清单是第三方写来的 JSON」这条前提：脏数据不能让表单炸掉，
 * 也不能让用户填了个寂寞（字段留着但没有 key、选项空着却标 required）。
 */
import { describe, expect, it } from "vitest"
import { initialFormValues, normalizeForm, validateFormValues } from "./form"

describe("normalizeForm", () => {
  it("非对象 / 缺 fields 时给出空表单，而不是抛错", () => {
    expect(normalizeForm(undefined)).toEqual({ fields: [] })
    expect(normalizeForm(null)).toEqual({ fields: [] })
    expect(normalizeForm("fields")).toEqual({ fields: [] })
    expect(normalizeForm([])).toEqual({ fields: [] })
    expect(normalizeForm({})).toEqual({ fields: [] })
    expect(normalizeForm({ fields: {} })).toEqual({ fields: [] })
  })

  it("丢弃没有 key 的字段：表单值以 key 为索引，没 key 就无处安放", () => {
    const form = normalizeForm({
      fields: [
        { key: "genre", type: "text", label: "题材" },
        { type: "text", label: "没有 key" },
        { key: "", type: "text", label: "空 key" },
        { key: "   ", type: "text", label: "空白 key" },
        { key: 42, type: "text", label: "非字符串 key" },
      ],
    })

    expect(form.fields.map((field) => field.key)).toEqual(["genre"])
  })

  it("未知 type 降级为 text，字段本身保留", () => {
    const form = normalizeForm({
      fields: [{ key: "weird", type: "color-picker", label: "怪类型" }],
    })

    expect(form.fields).toHaveLength(1)
    expect(form.fields[0].type).toBe("text")
    // 降级成 text 之后不该再带着下拉框的 options（否则 UI 不知道渲染成什么）
    expect(form.fields[0]).not.toHaveProperty("options")
  })

  it("label 缺失时用 key 兜底", () => {
    const form = normalizeForm({ fields: [{ key: "idea", type: "textarea" }] })
    expect(form.fields[0].label).toBe("idea")
  })

  it("select / multiselect 缺 options 时保留字段但给空数组", () => {
    const form = normalizeForm({
      fields: [
        { key: "genre", type: "select", label: "题材" },
        { key: "tags", type: "multiselect", label: "标签", options: "科幻" },
      ],
    })

    expect(form.fields[0].options).toEqual([])
    expect(form.fields[1].options).toEqual([])
  })

  it("选项里没有 value 的项被跳过，label 缺失时用 value 兜底", () => {
    const form = normalizeForm({
      fields: [
        {
          key: "genre",
          type: "select",
          label: "题材",
          options: [
            { value: "xuanhuan", label: "玄幻" },
            { value: "scifi" },
            { label: "没有 value" },
            "裸字符串",
          ],
        },
      ],
    })

    expect(form.fields[0].options).toEqual([
      { value: "xuanhuan", label: "玄幻" },
      { value: "scifi", label: "scifi" },
    ])
  })

  it("number 的 min > max 时交换，而不是报错", () => {
    const form = normalizeForm({
      fields: [{ key: "count", type: "number", label: "数量", min: 10, max: 1 }],
    })

    expect(form.fields[0].min).toBe(1)
    expect(form.fields[0].max).toBe(10)
  })

  it("maxLength <= 0 或非有限数时移除该约束", () => {
    const form = normalizeForm({
      fields: [
        { key: "a", type: "text", label: "A", maxLength: 0 },
        { key: "b", type: "text", label: "B", maxLength: -5 },
        { key: "c", type: "text", label: "C", maxLength: Number.NaN },
        { key: "d", type: "text", label: "D", maxLength: 12 },
      ],
    })

    expect(form.fields[0]).not.toHaveProperty("maxLength")
    expect(form.fields[1]).not.toHaveProperty("maxLength")
    expect(form.fields[2]).not.toHaveProperty("maxLength")
    expect(form.fields[3].maxLength).toBe(12)
  })

  it("非 select 类型带着 options 时忽略它", () => {
    const form = normalizeForm({
      fields: [
        {
          key: "a",
          type: "text",
          label: "A",
          options: [{ value: "x", label: "X" }],
        },
      ],
    })

    expect(form.fields[0]).not.toHaveProperty("options")
  })

  it("保留 default 的假值（false / 0 / 空数组）", () => {
    const form = normalizeForm({
      fields: [
        { key: "flag", type: "toggle", label: "开关", default: false },
        { key: "count", type: "number", label: "数量", default: 0 },
        { key: "tags", type: "multiselect", label: "标签", default: [] },
      ],
    })

    expect(initialFormValues(form)).toEqual({ flag: false, count: 0, tags: [] })
  })
})

describe("initialFormValues", () => {
  it("按类型给空值：文本给空串、多选给空数组、开关给 false", () => {
    const form = normalizeForm({
      fields: [
        { key: "title", type: "text", label: "标题" },
        { key: "idea", type: "textarea", label: "灵感" },
        { key: "tags", type: "multiselect", label: "标签" },
        { key: "flag", type: "toggle", label: "开关" },
      ],
    })

    expect(initialFormValues(form)).toEqual({ title: "", idea: "", tags: [], flag: false })
  })

  it("number / select 不设初始值：设成 0 或第一项会让用户以为就是自己选的", () => {
    const form = normalizeForm({
      fields: [
        { key: "count", type: "number", label: "数量" },
        { key: "genre", type: "select", label: "题材", options: [{ value: "a", label: "A" }] },
      ],
    })

    const values = initialFormValues(form)
    expect(values).not.toHaveProperty("count")
    expect(values).not.toHaveProperty("genre")
  })

  it("default 优先于类型空值", () => {
    const form = normalizeForm({
      fields: [
        { key: "count", type: "number", label: "数量", default: 5 },
        { key: "genre", type: "select", label: "题材", default: "scifi" },
        { key: "flag", type: "toggle", label: "开关", default: true },
      ],
    })

    expect(initialFormValues(form)).toEqual({ count: 5, genre: "scifi", flag: true })
  })
})

describe("validateFormValues", () => {
  const form = normalizeForm({
    fields: [
      { key: "genre", type: "select", label: "题材", required: true,
        options: [{ value: "xuanhuan", label: "玄幻" }, { value: "scifi", label: "科幻" }] },
      { key: "idea", type: "textarea", label: "你的灵感", required: true, maxLength: 10 },
      { key: "count", type: "number", label: "备选数量", default: 5, min: 1, max: 10 },
      { key: "tags", type: "multiselect", label: "标签", maxSelected: 2,
        options: [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }] },
      { key: "strict", type: "toggle", label: "严格模式" },
    ],
  })

  const valid = { genre: "scifi", idea: "末班车只有七个人", count: 5, tags: ["a"], strict: false }

  it("全部合法时返回 ok 与（可能被强制过的）值", () => {
    const result = validateFormValues(form, valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values.genre).toBe("scifi")
      expect(result.values.count).toBe(5)
    }
  })

  it("必填为空时报「请填写 + label」", () => {
    const result = validateFormValues(form, { idea: "   " })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.idea).toContain("请填写")
      expect(result.errors.idea).toContain("你的灵感")
      expect(result.errors.genre).toContain("请填写")
    }
  })

  it("number 做类型强制：字符串 \"5\" 变 5", () => {
    const result = validateFormValues(form, { ...valid, count: "5" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.count).toBe(5)
  })

  it("number 非数字报错", () => {
    const result = validateFormValues(form, { ...valid, count: "五个" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.count).toContain("必须是数字")
  })

  it("number 超出 min / max 报错", () => {
    const tooSmall = validateFormValues(form, { ...valid, count: 0 })
    expect(tooSmall.ok).toBe(false)
    if (!tooSmall.ok) expect(tooSmall.errors.count).toContain("不能小于 1")

    const tooBig = validateFormValues(form, { ...valid, count: 11 })
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) expect(tooBig.errors.count).toContain("不能大于 10")
  })

  it("text / textarea 超过 maxLength 报错", () => {
    const result = validateFormValues(form, { ...valid, idea: "一二三四五六七八九十十" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.idea).toContain("不能超过 10 个字符")
  })

  it("maxLength 按码点算：emoji 只算 1 个字符", () => {
    // 5 个 emoji 是 10 个 UTF-16 码元，按长度算会误报超长
    const result = validateFormValues(
      normalizeForm({ fields: [{ key: "t", type: "text", label: "短", maxLength: 5 }] }),
      { t: "😀😀😀😀😀" },
    )
    expect(result.ok).toBe(true)
  })

  it("multiselect 超过 maxSelected 报错", () => {
    const result = validateFormValues(form, { ...valid, tags: ["a", "b", "c"] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.tags).toContain("最多只能选 2 项")
  })

  it("multiselect 保证结果是 string[]", () => {
    const result = validateFormValues(form, { ...valid, tags: ["a", 2] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.tags).toEqual(["a", "2"])
  })

  it("select 的值必须在 options 内", () => {
    const result = validateFormValues(form, { ...valid, genre: "wuxia" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.genre).toContain("选项")
  })

  it("toggle 做布尔强制", () => {
    const result = validateFormValues(form, { ...valid, strict: "true" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.strict).toBe(true)
  })

  it("非必填的空值既不报错也不被强制成 0 / false", () => {
    const result = validateFormValues(form, { genre: "scifi", idea: "灵感", tags: [] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values).not.toHaveProperty("count")
      expect(result.values.tags).toEqual([])
    }
  })

  it("不修改调用方传入的 values 对象", () => {
    const input = { ...valid, count: "5" }
    validateFormValues(form, input)
    expect(input.count).toBe("5")
  })
})

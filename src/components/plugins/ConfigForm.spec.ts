/**
 * ConfigForm 的纯逻辑测试（`configSchema` → `FormField[]`）。
 *
 * 为什么重点测转换而不是渲染：渲染已经由 `SchemaForm.spec.tsx` 覆盖，两处共用
 * 同一个渲染器正是设计 §6.3 的要求。真正会悄悄坏掉的是**转换规则** ——
 * 尤其是密钥字段的识别（漏一个，密钥就以明文落盘了）。
 */
import { describe, expect, it, vi } from "vitest"
import { collectSecretErrors, convertConfigSchema } from "./ConfigForm"

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    defaultCount: { type: "number", title: "默认备选数量", default: 5, minimum: 1, maximum: 10 },
    style: { type: "string", title: "书名风格", enum: ["简洁", "爆点", "文艺"] },
    enabled: { type: "boolean", title: "启用增强" },
    apiKey: { type: "string", title: "API Key", format: "password", "x-qmai-secret": true },
    endpoint: { type: "string", title: "接口地址", description: "留空使用默认", maxLength: 120 },
    nested: { type: "object", title: "不支持的形状" },
  },
  required: ["apiKey"],
}

describe("convertConfigSchema", () => {
  it("按类型转成 6 种字段里的对应形状", () => {
    const { fields } = convertConfigSchema(schema)
    const byKey = Object.fromEntries(fields.map((field) => [field.key, field]))

    expect(byKey.defaultCount.type).toBe("number")
    expect(byKey.defaultCount.min).toBe(1)
    expect(byKey.defaultCount.max).toBe(10)
    expect(byKey.defaultCount.default).toBe(5)
    expect(byKey.style.type).toBe("select")
    expect(byKey.style.options?.map((option) => option.value)).toEqual(["简洁", "爆点", "文艺"])
    expect(byKey.enabled.type).toBe("toggle")
    expect(byKey.endpoint.type).toBe("text")
    expect(byKey.endpoint.maxLength).toBe(120)
    expect(byKey.endpoint.description).toBe("留空使用默认")
  })

  it("密钥字段被识别出来（format: password 与 x-qmai-secret 都算）", () => {
    const { secretKeys } = convertConfigSchema(schema)
    expect(secretKeys).toEqual(["apiKey"])
  })

  it("单独用 x-qmai-secret 标记也算密钥", () => {
    const { fields, secretKeys } = convertConfigSchema({
      type: "object",
      properties: { token: { type: "string", title: "令牌", "x-qmai-secret": true } },
    })
    expect(secretKeys).toEqual(["token"])
    // 密钥字段的说明要告诉用户"不会落盘、留空表示不修改"
    expect(fields[0].description).toContain("留空表示不修改")
  })

  it("必填来自 schema.required", () => {
    const { fields } = convertConfigSchema(schema)
    expect(fields.find((field) => field.key === "apiKey")?.required).toBe(true)
    expect(fields.find((field) => field.key === "style")?.required).toBeUndefined()
  })

  it("不支持的类型（object/array）跳过并 warn，不整份作废", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { fields } = convertConfigSchema({
      type: "object",
      properties: {
        nested: { type: "object", title: "对象" },
        list: { type: "array", title: "数组" },
        name: { type: "string", title: "名称" },
      },
    })
    expect(fields.map((field) => field.key)).toEqual(["name"])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it("空/坏 schema 返回空转换结果（界面显示「没有可配置项」）", () => {
    expect(convertConfigSchema(undefined)).toEqual({ fields: [], secretKeys: [] })
    expect(convertConfigSchema({ type: "object" })).toEqual({ fields: [], secretKeys: [] })
    expect(convertConfigSchema("不是对象")).toEqual({ fields: [], secretKeys: [] })
  })

  it("整数枚举也能转成字符串选项（select 的 value 只能是字符串）", () => {
    const { fields } = convertConfigSchema({
      type: "object",
      properties: { level: { type: "integer", title: "等级", enum: [1, 2, 3] } },
    })
    expect(fields[0].type).toBe("select")
    expect(fields[0].options?.map((option) => option.value)).toEqual(["1", "2", "3"])
  })
})

describe("collectSecretErrors（密钥必填判定）", () => {
  const fields = [
    { key: "apiKey", type: "text" as const, label: "API Key", required: true },
    { key: "endpoint", type: "text" as const, label: "接口地址" },
  ]

  it("已设过的密钥不要求重填（否则用户每次改别的项都要重输一次）", () => {
    expect(collectSecretErrors(fields, ["apiKey"], { apiKey: "" }, { apiKey: true })).toEqual({})
  })

  it("这次填了就算满足", () => {
    expect(collectSecretErrors(fields, ["apiKey"], { apiKey: "sk-1" }, { apiKey: false })).toEqual({})
  })

  it("既没填也没设过 → 报必填", () => {
    expect(collectSecretErrors(fields, ["apiKey"], { apiKey: "  " }, {})).toEqual({
      apiKey: "请填写API Key",
    })
  })

  it("非密钥字段不参与这套判定", () => {
    expect(collectSecretErrors(fields, [], {}, {})).toEqual({})
  })
})

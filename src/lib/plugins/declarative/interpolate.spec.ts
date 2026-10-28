/**
 * 插值测试。
 *
 * 两块重点：
 *   1. **转义**：`\{{foo}}` 必须原样吐出 `{{foo}}`，且不能把 `foo` 记进 missing
 *      （记进去会让校验器误报"变量不存在"，作者照报错去改名反而更乱）；
 *   2. **权限判定**：`requiresProjectAccess` 是「安装阶段就拒绝没权限的 action」的
 *      唯一依据，漏判等于让插件白拿用户的正文。
 */
import { describe, expect, it } from "vitest"
import { collectVariables, interpolate, requiresProjectAccess } from "./interpolate"

describe("interpolate", () => {
  const scope = {
    fields: { genre: "科幻", idea: "末班车只有七个人", count: 3, flag: false },
    config: { style: "简洁", tags: ["赛博", "末世"], nested: { deep: "深处" } },
    project: {
      bookTitle: "夜行",
      bookTags: ["都市", "悬疑"],
      bookIntro: "简介",
      protagonist: "无名",
      setting: "设定",
    },
    chapter: { title: "第一章", text: "正文内容" },
    selection: "选中的句子",
  }

  it("裸名查表单值", () => {
    expect(interpolate("题材：{{genre}}，灵感：{{idea}}", scope).text).toBe(
      "题材：科幻，灵感：末班车只有七个人",
    )
  })

  it("大括号内允许空格", () => {
    expect(interpolate("{{ genre }} / {{  idea  }}", scope).text).toBe(
      "科幻 / 末班车只有七个人",
    )
  })

  it("config / project / chapter / selection 四个命名空间", () => {
    expect(interpolate("{{config.style}}", scope).text).toBe("简洁")
    expect(interpolate("{{project.bookTitle}}", scope).text).toBe("夜行")
    expect(interpolate("{{chapter.text}}", scope).text).toBe("正文内容")
    expect(interpolate("{{selection}}", scope).text).toBe("选中的句子")
  })

  it("数组用中文顿号连接", () => {
    expect(interpolate("{{config.tags}}", scope).text).toBe("赛博、末世")
    expect(interpolate("{{project.bookTags}}", scope).text).toBe("都市、悬疑")
  })

  it("缺失变量替换成空串并记进 missing（不抛错）", () => {
    const result = interpolate("a{{nope}}b{{project.unknown}}c", scope)
    expect(result.text).toBe("abc")
    expect(result.missing).toEqual(["nope", "project.unknown"])
  })

  it("同一缺失变量只记一次", () => {
    const result = interpolate("{{nope}}{{nope}}", scope)
    expect(result.missing).toEqual(["nope"])
  })

  it("转义：\\{{foo}} 输出字面量 {{foo}}，且不进 missing", () => {
    const result = interpolate("\\{{foo}}", { fields: {} })
    expect(result.text).toBe("{{foo}}")
    expect(result.missing).toEqual([])
  })

  it("转义与真实变量可以共存", () => {
    const result = interpolate("\\{{genre}} 与 {{genre}}", scope)
    expect(result.text).toBe("{{genre}} 与 科幻")
    expect(result.missing).toEqual([])
  })

  it("数字 / 布尔值直接转字符串", () => {
    expect(interpolate("{{count}}/{{flag}}", scope).text).toBe("3/false")
  })

  it("点路径可以往下钻", () => {
    expect(interpolate("{{config.nested.deep}}", scope).text).toBe("深处")
  })

  it("空变量名原样保留，方便作者一眼看到写错了", () => {
    expect(interpolate("{{}}", scope).text).toBe("{{}}")
  })

  it("没有变量的模板原样返回", () => {
    const result = interpolate("就是一段普通文字", scope)
    expect(result.text).toBe("就是一段普通文字")
    expect(result.missing).toEqual([])
  })
})

describe("collectVariables", () => {
  it("抽出变量并去重，保留命名空间前缀", () => {
    expect(
      collectVariables("{{genre}} {{config.style}} {{chapter.text}} {{genre}} {{selection}}"),
    ).toEqual(["genre", "config.style", "chapter.text", "selection"])
  })

  it("忽略转义写法", () => {
    expect(collectVariables("\\{{foo}} {{bar}}")).toEqual(["bar"])
  })

  it("重复调用结果稳定（带 g 的正则有状态，不能残留 lastIndex）", () => {
    const template = "{{a}} {{b}}"
    expect(collectVariables(template)).toEqual(["a", "b"])
    expect(collectVariables(template)).toEqual(["a", "b"])
  })
})

describe("requiresProjectAccess", () => {
  it("引用 chapter.* 时为 true", () => {
    expect(requiresProjectAccess("{{chapter.text}}")).toBe(true)
  })

  it("引用 project.* 时为 true", () => {
    expect(requiresProjectAccess("书名：{{project.bookTitle}}")).toBe(true)
  })

  it("引用 selection 时为 true", () => {
    expect(requiresProjectAccess("请改写：{{selection}}")).toBe(true)
  })

  it("纯表单变量不需要项目权限", () => {
    expect(requiresProjectAccess("题材：{{genre}}，数量：{{count}}")).toBe(false)
  })

  it("config 变量不属于项目上下文", () => {
    expect(requiresProjectAccess("风格：{{config.style}}")).toBe(false)
  })

  it("转义后的 project.* 不算引用", () => {
    expect(requiresProjectAccess("\\{{project.bookTitle}}")).toBe(false)
  })
})

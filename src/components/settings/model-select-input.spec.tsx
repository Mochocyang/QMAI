/**
 * 设置组件的数据边界测试。
 *
 * 背景：设置页曾经因为 `value.trim()` 在 undefined 上调用而整页白屏，
 * 报错 `Cannot read properties of undefined (reading 'trim')`。
 *
 * 起因是持久化的设置草稿缺少字段 —— 类型声明说是 string，运行时不一定是。
 * 这组测试守住这个边界。
 *
 * 用 react-dom/server 渲染：项目没装 @testing-library，
 * 但服务端渲染同样会执行组件函数体，能捕获这类运行时崩溃。
 */

import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ModelSelectInput } from "@/components/settings/model-select-input"

const baseProps = {
  selectPlaceholder: "选择模型",
  inputPlaceholder: "输入模型 ID",
  onChange: () => {},
}

describe("ModelSelectInput 数据边界", () => {
  it("value 为 undefined 时不崩溃（旧配置缺字段）", () => {
    expect(() =>
      renderToStaticMarkup(
        <ModelSelectInput {...baseProps} value={undefined as unknown as string} options={[]} />,
      ),
    ).not.toThrow()
  })

  it("value 为 null 时不崩溃", () => {
    expect(() =>
      renderToStaticMarkup(
        <ModelSelectInput {...baseProps} value={null as unknown as string} options={[]} />,
      ),
    ).not.toThrow()
  })

  it("options 为 undefined 时不崩溃", () => {
    expect(() =>
      renderToStaticMarkup(
        <ModelSelectInput {...baseProps} value="" options={undefined as unknown as string[]} />,
      ),
    ).not.toThrow()
  })

  it("options 里混入 null / undefined 项时不崩溃", () => {
    expect(() =>
      renderToStaticMarkup(
        <ModelSelectInput
          {...baseProps}
          value="m1"
          options={["m1", null, undefined, "m2"] as unknown as string[]}
        />,
      ),
    ).not.toThrow()
  })

  it("正常值能渲染出选项", () => {
    const html = renderToStaticMarkup(
      <ModelSelectInput {...baseProps} value="bge-m3" options={["bge-m3", "bge-large-zh"]} />,
    )
    expect(html).toContain("bge-m3")
    expect(html).toContain("已拉取 2 个模型")
  })

  it("value 为空串时渲染占位项", () => {
    const html = renderToStaticMarkup(
      <ModelSelectInput {...baseProps} value="" options={["a", "b"]} />,
    )
    expect(html).toContain("选择模型")
  })
})

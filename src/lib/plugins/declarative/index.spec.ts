/**
 * 统一出口的冒烟测试。
 *
 * 唯一目的是挡住"规则都在，但没人能 import 到"这种低级断裂：C1 的组件、
 * 将来的 validate CLI、单测都只从 `index.ts` 进来，一旦某个名字在重构中
 * 掉出 re-export，表现是别的模块编译不过或运行期 undefined，而不是这里红。
 */
import { describe, expect, it } from "vitest"
import * as declarative from "./index"

describe("declarative 统一出口", () => {
  it("导出全部公开函数", () => {
    expect(typeof declarative.normalizeForm).toBe("function")
    expect(typeof declarative.initialFormValues).toBe("function")
    expect(typeof declarative.validateFormValues).toBe("function")
    expect(typeof declarative.interpolate).toBe("function")
    expect(typeof declarative.collectVariables).toBe("function")
    expect(typeof declarative.requiresProjectAccess).toBe("function")
    expect(typeof declarative.parseOutput).toBe("function")
    expect(typeof declarative.parseContentPack).toBe("function")
    expect(typeof declarative.filterContentItems).toBe("function")
    expect(typeof declarative.collectTags).toBe("function")
  })

  it("六个字段类型常量与内容包上限常量都在", () => {
    expect(declarative.FIELD_TYPES).toEqual([
      "text",
      "textarea",
      "number",
      "select",
      "multiselect",
      "toggle",
    ])
    expect(declarative.DEFAULT_MAX_CONTENT_ITEMS).toBe(5000)
  })
})

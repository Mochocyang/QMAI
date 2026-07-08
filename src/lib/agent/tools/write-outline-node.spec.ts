import { describe, expect, it } from "vitest"
import {
  buildOutlineNodeWriteContent,
  validateOutlineWriteTarget,
} from "./write-outline-node"

describe("write-outline-node helpers", () => {
  it("保留已经带标题的完整 Markdown 内容", () => {
    const content = buildOutlineNodeWriteContent("第1章", "# 章纲（第001章）\n\n正文")

    expect(content).toBe("# 章纲（第001章）\n\n正文\n")
  })

  it("为节点内容补充二级标题", () => {
    const content = buildOutlineNodeWriteContent("第1章", "正文")

    expect(content).toBe("## 第1章\n\n正文\n")
  })

  it("拒绝不安全的大纲写入目标", () => {
    expect(validateOutlineWriteTarget("../章纲.md")).toContain("上级目录")
    expect(validateOutlineWriteTarget("C:/Book/章纲.md")).toContain("绝对路径")
    expect(validateOutlineWriteTarget("章纲.txt")).toContain("Markdown")
    expect(validateOutlineWriteTarget("章纲/章纲-第001章.md")).toBeNull()
  })
})

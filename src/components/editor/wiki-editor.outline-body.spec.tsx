// @vitest-environment jsdom

// 回归：大纲正文在**阅读态**被吃掉一整节。
//
// 现场：导入后的 D:\QM-BOOK\楚白\QM\outlines\00-设定集.md 与源文件
// E:\高人一等\修改方案\00-设定集.md 逐字节相同（427 行 / 31578 B），
// 也就是说**导入没有丢内容**；丢的是显示——`WikiEditor` 用容错的
// `parseFrontmatter` 切 body（wiki-editor.tsx:764），阅读态再把切过的
// body 交给 `WikiReader`（:829）。正文里的 `---` 是分隔线，却被当成
// frontmatter 围栏，于是标题、用途说明、`## 1. 定位` 表格和三条全书
// 纪律全都不见了，正文直接从 `## 1. 金手指` 开始。
//
// 这一条守的是"用户看得见的那一层"：即使 frontmatter 解析被改坏，
// 只要阅读态渲染不出文档自带的标题与首节，这里就会红。

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { WikiEditor } from "./wiki-editor"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 真实文件的结构（行号与盘上一致，这一点是关键）：
 * 第 6 行的 `---` 正好落在 parseFrontmatter 容错分支的门槛
 * `lineNumberAt() > 6` 上，6 > 6 为假 → 旧实现放行并切掉它。
 */
const SETTING_DOC = [
  "# 《高人一等》设定集（修订版 v1）", // 1
  "", // 2
  "> 用途：这是往下写每一章都要对照的“宪法”。", // 3
  "> 适用范围：番茄/七猫签约向男频爽文。", // 4
  "", // 5
  "---", // 6 ← 分隔线，不是 frontmatter 围栏
  "", // 7
  "## 0. 定位", // 8
  "",
  "| 项 | 内容 |",
  "| --- | --- |",
  "| 类型 | 男频穿越玄幻 · 宠妻萌娃 + 打脸复仇 |",
  "",
  "**全书纪律（三条，写崩了先回来读这三条）**",
  "",
  "1. 打脸要打在欠打的人身上，力度跟恶行对等。",
  "2. 金手指的规则一次都不许破。",
  "3. 每一个“爽”都要有代价。",
  "",
  "---", // 24 ← 分隔线
  "",
  "## 1. 金手指：高人一等令牌（重订）",
  "",
  "### 1.1 规则表（全书必须遵守）",
  "",
  "| 项 | 设定 |",
  "| --- | --- |",
  "| 触发 | 濒死时 |",
  "",
].join("\n")

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  useWikiStore.setState(useWikiStore.getInitialState())
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.removeChild(container)
})

describe("大纲阅读态不丢正文", () => {
  it("文档自带的标题、0.定位 表格和全书纪律都要渲染出来", async () => {
    await act(async () => {
      root.render(
        <WikiEditor content={SETTING_DOC} onSave={() => {}} defaultMode="read" />,
      )
    })

    const text = container.textContent ?? ""

    // 标题：旧实现把这一行当 frontmatter 吃掉了。
    expect(text).toContain("《高人一等》设定集（修订版 v1）")
    // 用途说明。
    expect(text).toContain("这是往下写每一章都要对照的“宪法”")
    // 整节 0. 定位（表格）+ 三条全书纪律。
    expect(text).toContain("0. 定位")
    expect(text).toContain("男频穿越玄幻 · 宠妻萌娃 + 打脸复仇")
    expect(text).toContain("全书纪律（三条，写崩了先回来读这三条）")
    expect(text).toContain("打脸要打在欠打的人身上，力度跟恶行对等。")
    expect(text).toContain("金手指的规则一次都不许破。")
    expect(text).toContain("每一个“爽”都要有代价。")
    // 后面的章节也要在（确认不是整篇都没渲染）。
    expect(text).toContain("1. 金手指：高人一等令牌（重订）")
    expect(text).toContain("1.1 规则表（全书必须遵守）")
    expect(text).toContain("濒死时")
  })
})

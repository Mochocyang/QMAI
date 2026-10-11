# 换算会打破的既有测试断言 —— 必须同步更新的完整清单

**用途**：任务 2（应用 px→rem 换算）与任务 4（放宽字号范围到 80%–150%）执行时，
按下表同步更新断言。否则 `npm run test:mocks` 会出现**新增失败文件**，
违反"新增失败文件 0"的验收判据。

**清单完整性的依据**（两种独立方法交叉核对）：
1. 以 `git ls-files` 列出全部 **683** 个测试文件，逐个搜索同时含
   `"font"` / `font-size` / `fontSize` / `font:` / `line-height` / `lineHeight` /
   `font-family` 与 `Npx` 的行 → 命中 **3 个文件 / 7 处**。
2. 搜索全部 `declaration(...)` 与 `hasDeclaration(...)` 助手调用（它们读 CSS 源文本，
   最容易被打断）→ 命中同一组位置，无遗漏。

**这 3 个文件当前全部通过**（实测 `66 tests passed`：header-alignment 8、
shelf 30、tools 28）。因此下面的每一处若不更新，都会**新增**失败。

---

## 一、任务 2（px→rem 换算）必须更新的 7 处

期望值由 codemod 自身的 `convertCss()` 直接导出（不是手算），因此与实际换算结果必然一致。

| # | 文件:行 | 现状断言 | 改为 |
|---|---|---|---|
| 1 | `src/components/uitest/ui-test-header-alignment.spec.ts:21` | `declaration("ui-test-editor.css", ".ui-test-root .ui-test-editor-title", "font")` → `"500 20px/28px var(--serif)"` | `"500 1.25rem/1.75rem var(--serif)"` |
| 2 | `src/components/uitest/ui-test-header-alignment.spec.ts:43` | `declaration("ui-test-tools.css", '.ui-test-root [data-ui="soul-role-content"] .mb-4 > h2', "font")` → `"500 20px/28px var(--serif)"` | `"500 1.25rem/1.75rem var(--serif)"` |
| 3 | `src/components/uitest/ui-test-shelf.test.tsx:490` | `expect(css).toMatch(/font:\s*600\s+16px\s*\/\s*24px/)` | `expect(css).toMatch(/font:\s*600\s+1rem\s*\/\s*1\.5rem/)` |
| 4 | `src/components/uitest/ui-test-shelf.test.tsx:491` | `expect(css).toMatch(/font-size:\s*14px;\s*line-height:\s*22px/)` | `expect(css).toMatch(/font-size:\s*0\.875rem;\s*line-height:\s*1\.375rem/)` |
| 5 | `src/components/uitest/ui-test-shelf.test.tsx:540` | `expect(actionStyle.fontSize).toBe("13px")` | `expect(actionStyle.fontSize).toBe("0.8125rem")` |
| 6 | `src/components/uitest/ui-test-shelf.test.tsx:555` | `expect(hint.fontSize).toBe("14px")` | `expect(hint.fontSize).toBe("0.875rem")` |
| 7 | `src/components/uitest/ui-test-tools.spec.tsx:390` | `hasDeclaration('.ui-test-root .ui-test-page-title', "font-size", "20px")` | `... "1.25rem")` |

### 对应 CSS 源（换算前 → 换算后，实测）

```
ui-test-editor.css:64   font: 500 20px/28px var(--serif)  →  font: 500 1.25rem/1.75rem var(--serif)
ui-test-tools.css:401   font: 500 20px/28px var(--serif)  →  font: 500 1.25rem/1.75rem var(--serif)
ui-test-tools.css:26    font-size: 20px                   →  font-size: 1.25rem
ui-test-shelf.css:200   font: 600 16px/24px var(--ui)     →  font: 600 1rem/1.5rem var(--ui)
ui-test-shelf.css:203   font-size: 14px; line-height: 22px →  font-size: 0.875rem; line-height: 1.375rem
ui-test-shelf.css:57    font-size: 13px                   →  font-size: 0.8125rem
ui-test-shelf.css:259   font-size: 14px; line-height: 1.8 →  font-size: 0.875rem; line-height: 1.8
```

### ⚠️ 第 5、6 处为何也必须改（曾被认为"可能不用改"）

`#5`/`#6` 用 jsdom 的 `getComputedStyle().fontSize`。已用探针**实测确认**
（`@vitest-environment jsdom`，临时探针跑完即删）：

```
font-size: 0.8125rem       -> fontSize = "0.8125rem"   ← 原样返回，不解析为 px
font-size: 13px            -> fontSize = "13px"
font-size: 0.8em           -> fontSize = "0.8em"
font: 500 1.25rem/1.75rem  -> fontSize = "1.25rem" / lineHeight = "1.75rem"
```

即 **jsdom 不做单位归一化**，`0.8125rem` 不会被算成 `13px`。
所以这两处断言**必然失败**，期望值必须写 rem 字面量。

> 反过来也说明：这两处测试**无法**证明"字号会随界面字号缩放"——
> jsdom 里根本没有根字号概念。它们只断言"声明值是什么"。
> 真正的缩放证明只能靠 `census-computed-font.mjs`（真实浏览器）。

---

## 二、任务 4（放宽到 80%–150%、预设改 85/100/125/150）必须更新的 1 处

| # | 文件:行 | 现状 | 问题 | 改为 |
|---|---|---|---|---|
| 8 | `src/components/uitest/ui-test-tools.spec.tsx:250-252` | `scale.value = "1.15"` → 断言 `setDraft(..., "uiFontSizeScale", 1.15)` 且滑块 `"115"` | 任务 4 把预设改为 85/100/125/150 后，**`1.15` 不再是合法预设项**，`select.value = "1.15"` 会被浏览器忽略（选中项不变），断言必失败 | 用新的预设值，例如 `"1.25"` → 断言 `1.25` 与 `"125"` |

该测试的其余部分（`界面字体` 选项与 `UI_FONT_OPTIONS` 一致、`simsun` 写入草稿）不受影响：

- `ui-test-tools.spec.tsx:244` 断言下拉选项**等于** `UI_FONT_OPTIONS.map(v => v.value)`
  —— 这是自指断言，任务 8 改选项表后**自动跟随**，无需改。
- `ui-test-tools.spec.tsx:184` 的 `as SettingsDraft` 是类型断言，
  任务 7 往 `SettingsDraft` 加字段**不会**使它报错。

---

## 三、确认不受影响的相邻断言（避免误改）

- `ui-test-header-alignment.spec.ts:17,22-24,27-29,33-35,39-42,47-55,62-63`：
  断言的是 `padding` / `min-height` / `line-height: var(--ui-heading-line)` 等
  **布局或变量**，换算只动字号与行高数值，不碰它们。
  特别地 `:35` 与 `:18` 断言 `line-height` 为 `var(--ui-heading-line)` —— 是变量，不变。
- `ui-test-tools.spec.tsx:391`：`font-family` 为 `var(--serif)` —— 任务 5/6 改变的是
  `--serif` 的**定义**，这条断言读的是**声明文本**，仍为 `var(--serif)`，不变。
- `font-settings.spec.ts:31` 断言 `--qmai-ui-font-family` 含 `Microsoft YaHei` ——
  任务 8 的 `microsoft-yahei` 选项仍以 `"Microsoft YaHei"` 开头，不变。

---

## 四、执行顺序建议

1. 先跑一次这 3 个文件，确认当前全绿（应 66 passed）——作为"改动前"证据。
2. 运行 codemod 应用换算。
3. **同一提交内**更新上表 1–7 处断言。
4. 再跑这 3 个文件，应仍全绿。
5. 全量 A/B 时确认这 3 个文件**不在**新增失败名单里。

任务 4 单独提交时更新第 8 处。

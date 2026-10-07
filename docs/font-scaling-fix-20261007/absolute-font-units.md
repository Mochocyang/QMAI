# 绝对单位字号/行高 · 完整清单

生成时间: 2026-10-07T17:13:07.328Z

需改（绝对单位）: 0 个数值（553 处声明；差值 12 为 font 简写的行高部分）
无需改（相对单位）: 563 个数值

## 经自定义属性间接传递的 px（codemod 看不见）

| 变量 | 值 | 定义处 | 消费属性 | 判定 |
|---|---|---|---|---|
| `--radius` | 10px | src/components/uitest/ui-test.css:51 | --radius-sm, --radius-md, --radius-lg, --radius-xl, xl | 白名单：圆角，与文字无关 |
| `--ui-heading-top` | 22px | src/components/uitest/ui-test.css:10 | padding, padding-top | 白名单：纯外部留白（只用于 padding/padding-top），不参与文字布局；界面字号放大时留白保持不变是刻意选择 |

## 需改清单

| 文件 | 行 | 类型 | 值 | 原文 |
|---|---|---|---|---|
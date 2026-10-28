# 我的内容插件

一个纯声明式 QMAI 插件：**不含任何要执行的代码**（Tier 1）。宿主读你的清单、读你的内容包、
自己渲染表单、自己调模型、自己按 `output.targets` 写回 —— 你一行代码都不用写。

## 里面有什么

```
plugin.json            清单（唯一必需的文件）
content/items.json     内容包（= 灵感素材，2 条示例）
```

## 三件事要做

1. **改 `plugin.json` 的 `name` / `description`**：这两句是用户在插件中心唯一会看的东西。
2. **换掉 `content/items.json` 的内容**：`version` 必须是数字 `1`；每条要有非空的
   `id`（包内唯一）、`title`、`body`，`tags` 可选。单包上限 5MB / 5000 条。
3. **改提示词**：`contributes.actions[0].prompt` 里 `{{config.style}}` 读的是 `configSchema`
   的配置值，`{{idea}}` / `{{count}}` 读的是表单字段。引用 `{{project.*}}` / `{{chapter.*}}` /
   `{{selection}}` 必须在 `permissions` 里声明 `fs:project-read`。

## 本地先验一遍

```powershell
node <SDK>/validate.mjs .
```

它会在装进 QMAI 之前把清单错误、内容包问题、提示词变量问题一次报全。

## 装进 QMAI

设置 → 插件 → 「从本地目录安装」，选这个目录。
纯声明式插件不会启动任何进程，`processState` 恒为 `declarative`。

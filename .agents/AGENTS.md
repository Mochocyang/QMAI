# 项目基本逻辑

## 产品定位

QMAI 是**长篇小说记忆型 AI 写作桌面系统**（Tauri 2 + React 19 + TypeScript），不是普通聊天写作工具。目标场景：200 万～300 万字连载，解决 AI 遗忘前文、人设崩坏、时间线混乱、伏笔丢失。

核心理念：**写前自动提取上下文 → 写后自动沉淀章节记忆 → 图谱追踪关系变化 → 审查防崩坏 → 人工确认定稿**。

## 核心工作流（不可违背）

1. **写前**：`buildContextPack()` 组装上下文包，按优先级裁剪 token（`src/lib/novel/context-engine.ts`）
2. **生成**：LLM 输出默认为**草稿**，不写入正式记忆库
3. **写后**：用户确认正式保存 → `ingestChapter()` 章节摄取 → 生成快照 JSON + 更新向量索引 + 增量更新图谱
4. **审查**：六维审稿 + 连贯性 Lint + 角色一致性检查，草稿隔离直到人工确认

## 上下文包优先级

```
用户指定 > 章节细纲 > 上一章结尾 > Canon 正史 > 人物状态 > 伏笔 > 最近摘要 > 正文片段 > 图谱 > 向量/关键词检索
```

修改上下文逻辑时，保持 `SECTION_PRIORITY` 顺序，并考虑 token 预算二次裁剪。

## 代码分层

| 层级 | 路径 | 职责 |
|------|------|------|
| UI | `src/components/` | React 组件，不含核心业务 |
| 状态 | `src/stores/` | Zustand（wiki-store、review-store 等） |
| 小说引擎 | `src/lib/novel/` | 记忆、上下文、摄取、审查、图谱、拆书 |
| 通用工具 | `src/lib/` | LLM 客户端、搜索、嵌入、持久化 |
| 后端 | `src-tauri/` | 文件系统、向量存储、进程 |

小说相关逻辑优先放 `src/lib/novel/`，通过 `mod.ts` 导出；不要散落在 UI 组件里。

## 文档放置

功能分支说明、开发备忘、设计笔记一律写在 `docs/`，不要新建到仓库根目录。

- 分支说明命名：`docs/<分支名>-分支说明.md`
- 已有同类文件只改 `docs/` 里的副本，不要在根目录再写一份
- `scripts/dev/notes/` 只留给脚本侧临时笔记，新的分支说明不要往那里放

## 数据与隔离原则

- 本地存储：项目目录 = Markdown（章节正文）+ JSON（快照/状态）+ LanceDB（向量）
- **草稿 ≠ 正式章节**：未确认内容不得触发摄取、不得污染记忆库
- 角色认知（knows / does_not_know）必须在校验和上下文中保持一致
- 图谱节点/边来自章节摄取快照，增量更新而非全量重建

## 改动时的检查清单

- 是否破坏草稿隔离？
- 是否影响上下文包优先级或 token 预算？
- 正式章节保存路径是否仍触发摄取 pipeline？
- 新增 LLM 调用是否走 `resolveNovelModel()` / `resolveReviewModel()`？
- UI 改动是否只需调 store，而非复制业务逻辑？

## Cursor Cloud specific instructions

标准命令见 `README.md`（`## 本地开发`）与 `package.json` 的 `scripts`。以下是云端环境非显而易见的注意事项：

- **运行完整应用**：`npm run tauri dev`（Vite 固定端口 1420 + Rust 桌面窗口）。云 VM 已有虚拟显示 `DISPLAY=:1`，GUI 可正常弹出；软件渲染下 `libEGL ... DRI3` 警告可忽略。
- **Rust 工具链**：后端依赖（经 `lancedb` → `icu_provider`）需要 `edition2024`，即 **Rust ≥ 1.85**。若遇 `feature edition2024 is required`，说明 rustc 太旧，执行 `rustup update stable && rustup default stable` 即可。首次 `cargo build`（在 `src-tauri/`）会编译 lancedb，约 4 分钟。
- **系统依赖**：Tauri Linux 构建需 `libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`、`patchelf`、`protobuf-compiler`（`protoc`，由 lancedb 构建期需要）。这些已装入快照。
- **Node**：`.nvmrc`/CI 用 Node 24（登录 shell 经 nvm 默认到 24）；`/exec-daemon/node`（v22）也满足 Vite 8（≥22.12）。两者皆可跑 `npm install`/测试/构建。
- **新建项目目录**：这是面向 Windows 的应用，新建对话框默认目录是 `D:\QM-BOOK`，在 Linux 上无效且不会真正落盘。要在 Linux 上创建可持久化的项目，请在“小说目录”输入框清空后手动填入有效路径（如 `/home/ubuntu/QM-BOOK`）再点“创建”。应用数据存于 `~/.local/share/com.qingmuai.writer/`。
- **LLM 密钥**：启动应用、跑 `test:mocks`、构建都不需要密钥。生成/摄取/审查/拆书等功能才需要 LLM——在“设置”里配置，或设置 `VITE_QMAI_LLM_API_KEY` + `VITE_QMAI_LLM_ENDPOINT` + `VITE_QMAI_LLM_MODEL`（三者需同时提供）。`npm run test:llm` 属于真实 LLM 测试，需要密钥，默认被 `test:mocks` 排除。

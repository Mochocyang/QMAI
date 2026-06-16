# feature/book-analysis-6d-skill — 拆书 Skill 6 维度分析

## 目标

把当前"1 个合并 prompt → 1 个 Markdown"的 Skill 生成，重构为"6 个维度分析 prompt → 6 份研究文件 → SKILL.md"。
让拆书 Skill 的质量与 `character-aura` 的灵魂工作流对齐。

## 设计决策（用户已确认）

| 决策点 | 选择 |
|---|---|
| 外部评价网络搜索 | **A：接入 web 搜索**（需要 Tauri shell / 现有搜索能力） |
| Token 成本 | **C：用户可选深度**（快速 / 标准 / 完整），弹窗确认 |
| 名称归一 | **A：写入 `metadata.json`** 持久化 |
| 分支 | `feature/book-analysis-6d-skill`（新开） |

## 实施步骤

### 步骤 1：分支 + 基线（不动旧代码）
- 新建 `feature/book-analysis-6d-skill` 分支（基于当前 HEAD）
- 验证：能正常 build

### 步骤 2：扩展类型与存储（`types.ts` + `metadata.json`）
- 新增 `AnalysisDepth = "fast" | "standard" | "deep"`
- 新增 `NameAliasMap = Record<canonicalName, string[]>`，写入 `metadata.json`
- 进度百分比重新分配：
  - 0-30%：章节拆分
  - 30-50%：角色识别
  - 50-70%：角色深度分析
  - 70-95%：6 维度 Skill（标准/完整）
  - 95-100%：保存元数据

### 步骤 3：实现 `alias-resolver.ts`（名称归一）
- `buildNameAliasMap(characters)`：从所有角色 + 关系网中抽取别名，构建归一表
- `getCanonicalName(aliasMap, name)`：查表
- 写入 `metadata.json.aliasMap`
- **不动 LLM**，纯数据处理

### 步骤 4：实现 `six-dimension-prompts.ts`（6 个 prompt）
| # | 维度 | 文件 | 截断 |
|---|---|---|---|
| 1 | 公开资料 | `01-public-info.md` | 20000 |
| 2 | 对话方式 | `02-conversations.md` | 16000 |
| 3 | 表达特征 | `03-expression.md` | 16000 |
| 4 | 外部评价 | `04-external-views.md` | 12000 + web |
| 5 | 决策记录 | `05-decisions.md` | 20000 |
| 6 | 时间线 | `06-timeline.md` | 16000 |

每个 prompt 模板：
- 输入：角色名、别名表（归一后）、源章节内容（截断）
- 输出：Markdown 片段
- 名称归一：在 prompt 开头注入"角色名 = 许七安；别名 = 大郎/许哥/许银锣"

深度档位：
- **快速**（fast）：跳过维度 4（外部评价），其他 5 维度跑 → 5 次/角色
- **标准**（standard）：6 维度全跑，无网络搜索 → 6 次/角色
- **完整**（deep）：6 维度全跑 + 外部评价启用 web → 6 次/角色 + 网络请求

### 步骤 5：实现 `six-dimension-engine.ts`
- 接口 `generateSixDimensionSkill(character, metadata, llmConfig, depth, signal)`
- 进度回调
- 失败降级：单维度失败 → 用模板填充并标记 `[AI 抽取失败]`
- 返回 `researchFiles: { "01-...": "...md" }` + `skillContent`（SKILL.md 主体）

### 步骤 6：更新 `skill-generator.ts`
- 改为薄壳：转发到 `six-dimension-engine.generateSixDimensionSkill()`
- 保留旧的快速模式（向后兼容）

### 步骤 7：更新 `aura-adapter.ts`
- `buildGeneratedAuraInputFromBookCharacter` 接收新的 6 维度研究文件
- 透传到 `createCustomCharacterAuraFromGeneratedSkill` 的 `researchFiles` 字段
- 保持原有 6 个文件名约定（`01-writings.md` 等）以兼容下游

### 步骤 8：UI 弹窗确认（深度选择）
- 文件：`book-analysis-input-dialog.tsx` 或新的 `analysis-depth-dialog.tsx`
- 用户进入拆书流程时弹窗：
  - 快速（约 1×token，5 维度）
  - 标准（约 6×token，6 维度，**推荐**）
  - 完整（约 6×token + 网络搜索，6 维度 + web）
- 选择存到 `metadata.json.analysisDepth`

### 步骤 9：web 搜索能力接入
- 方案：用 `@tauri-apps/plugin-shell` 调外部搜索 API？
- 实际：参考项目是否已有 web_fetch / web_search MCP 工具？
- **风险**：本机可能没有 Tauri 端的搜索命令。**降级方案**——`depth=deep` 时显示提示"当前环境未启用网络搜索，外部评价将从原文抽取"

### 步骤 10：单测
- `alias-resolver.spec.ts`：归一表构建 + 查表
- `six-dimension-prompts.spec.ts`：prompt 模板变量正确替换
- `six-dimension-engine.spec.ts`：mock LLM，验证 6 维度全部调用、深度档位正确

### 步骤 11：lint + test + typecheck + 打包
- 跑全套质量门
- 失败用例与本任务无关的允许存在（real-llm / worktrees / codex-temp）

### 步骤 12：更新日志
- `GenxinLOG/更新日志.md` 追加 22:55 条目

## 风险与权衡

1. **Token 成本**——标准/完整模式 6N 次 LLM 调用（之前是 N 次）
2. **网络搜索**——Tauri 端可能没有现成工具，需要降级到"原文抽取"
3. **章节内容长度**——目前 6 维度的总截断约 100K 字符/角色，比原来 8K 字符多 12 倍
4. **旧 skill 文件不重跑**——已经在 `<bookPath>/skills/` 下的 skill 不受影响，新生成的会带 `[6维度]` 标记

## 不在本次范围

- 不改 `analysis-engine.ts` 章节拆分逻辑
- 不改 `character-extraction-engine.ts` 角色识别 + 深度分析
- 不动 `aura-cleanup.ts` / `aura-adapter.ts` 已有灵魂清理逻辑
- 不改侧边栏 / 结果页 UI（除非深度选择弹窗需要）

## 验证清单

- [ ] 新分支能 build
- [ ] 6 维度 prompt 模板单测通过
- [ ] alias-resolver 单测通过
- [ ] 旧功能（章节拆分、角色识别、添加灵魂、删除作品、清理孤儿）回归通过
- [ ] 打包便携版成功

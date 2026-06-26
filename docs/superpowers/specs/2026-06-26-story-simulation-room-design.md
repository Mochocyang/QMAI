# 剧情推演室（Story Simulation Room）设计文档

> 创建日期：2026-06-26
> 状态：已确认，待实施
> 分支：feature-story-simulation（独立分支，不合并 main）

## 1. 背景与目标

### 1.1 来源

将 MiroFish-local（AI 社会仿真/预测引擎）的核心仿真能力，以 TypeScript 重写方式集成到 QMAI 小说写作软件中，把"社媒舆论预测"改造为"小说剧情推演"。

### 1.2 核心价值

当小说作者写到一半不知道剧情如何发展时，可以触发"剧情推演室"：
- AI 自动提取已写章节的全维度内容（角色特征、世界规则、力量体系、伏笔、时间线等）
- 生成故事框架（起承转合关键节点），用户确认后投入推演
- 多 Agent 仿真推演角色在给定情境下的行为选择和剧情走向
- 生成推演报告 + 故事草稿供作者参考

### 1.3 MiroFish 与 QMAI 的改造对应关系

| MiroFish 原版 | 小说改造版 | 改造说明 |
|-------------|----------|---------|
| `OntologyGenerator`（社媒实体类型） | `StoryExtractor`（小说实体提取） | 不再 LLM 生成实体类型，直接从 QMAI 角色数据提取 |
| `OasisProfileGenerator`（社媒 Agent 人设） | `AgentProfileBuilder`（角色 Agent 构建） | 从角色光环/灵魂/认知构建，不重新生成 |
| OASIS 仿真（发帖/点赞/转发） | `SimulationEngine`（对话/行动/决策） | 行为类型完全重写为小说角色行为 |
| `SimulationConfigGenerator`（中国作息参数） | 故事框架 + 字数预算 | 不再模拟时间/活跃度，改为框架节点 + 字数约束 |
| `ZepGraphMemoryManager`（活动回写图谱） | 章节快照更新 | 仿真结果可选写入章节快照 |
| `ReportAgent`（ReACT 预测报告） | `SimulationReportAgent`（ReACT 推演报告） | 检索工具改为 QMAI 的图谱/向量检索 |
| Zep/Graphiti + Neo4j（时序图谱） | QMAI 现有 LanceDB + Graphology + 章节快照 | 不引入 Neo4j，复用现有基础设施 |

## 2. 工程隔离要求

**这是最高优先级的工程约束：**

- 剧情推演室是独立功能，在独立 feature 分支 `feature-story-simulation` 开发
- **不合并 main 分支**，作为测试版独立分发
- 功能体量大，开发周期长，中途 main 分支可能有其他 BUG 修复直接上传 GitHub
- 独立分支确保主版本发布不会意外带入未完成的大功能
- 符合用户规则："新功能一定放到分支里做"、"main 分支永远保持稳定可打包"

## 3. 实现方案

**方案A：复用 QMAI 现有基础设施（已选定）**

- 不引入 Neo4j 或任何外部图数据库
- 复用 QMAI 现有 LanceDB 向量库 + Graphology 内存图库 + 章节快照体系
- 仿真引擎纯 TypeScript 实现，多 Agent 决策循环
- 报告生成复用 QMAI 的 LLM 调用（`llm-client.ts`），用 ReACT 模式
- 零新依赖，完全融入 QMAI，打包无额外负担

## 4. 模块结构

### 4.1 核心逻辑层

```
src/lib/novel/story-simulation/
├── types.ts                             ← 类型定义
├── story-extractor.ts                   ← 全维度内容提取器
├── agent-profile-builder.ts             ← Agent 人格构建器
├── story-framework-generator.ts         ← 故事框架生成器
├── simulation-engine.ts                 ← 仿真引擎核心
├── simulation-modes/
│   ├── event-driven.ts                  ← 事件驱动推演
│   ├── free-emergence.ts                ← 自由涌现推演
│   ├── decision-tree.ts                 ← 决策树推演
│   └── hybrid.ts                        ← 混合模式
├── simulation-report-agent.ts           ← 推演报告生成器（ReACT）
├── story-draft-generator.ts             ← 故事草稿生成器
└── framework-store.ts                   ← 故事框架持久化
```

### 4.2 UI 组件层

```
src/components/novel/story-simulation/
├── story-simulation-view.tsx            ← 主视图
├── simulation-config-panel.tsx          ← 单页配置面板
├── extraction-progress.tsx              ← 提取进度展示
├── framework-confirm-panel.tsx          ← 框架确认面板
├── simulation-mode-selector.tsx        ← 模式选择器（独立按钮）
├── simulation-progress.tsx             ← 仿真进度展示
├── simulation-report-view.tsx          ← 推演报告展示
├── story-draft-view.tsx                ← 故事草稿展示
├── framework-list.tsx                 ← 二栏：故事框架列表
├── framework-binding-dialog.tsx       ← AI 会话绑定对话框
└── simulation-result-list.tsx          ← 三栏：推演结果列表
```

## 5. 完整流程

### 5.1 主流程

```
用户点击"剧情推演室"
  ↓
单页配置：
  ① 仿真模式选择（事件驱动/自由涌现/决策树/混合）
  ② 用户思路输入（可选）
  ③ 目标字数选择（10000/30000/50000/自定义）
  ④ 提取章节数量选择（最近N章）
  ↓ 点击"开始提取并生成框架"
后台全维度提取
  ↓ 提取完成
生成故事框架（起承转合关键节点，受字数预算约束）
  ↓
框架展示 → 用户确认
  ├→ 不满意：重新生成框架（可多次，可调整思路后重试）
  └→ 满意：保存框架 + 开始推演
  ↓
仿真推演运行（基于框架约束 + 用户选择的模式 + 字数预算控制轮次）
  ↓
生成推演报告（角色行为分析 + 走向分支 + 合理性分析）
  ↓
报告展示 → 用户确认
  ├→ 不满意：重新推演（可调整参数）
  └→ 满意：生成故事草稿
  ↓
故事草稿（遵循小说写作结构，总字数接近目标字数）
```

### 5.2 单页配置面板

```
┌─────────────────────────────────────────────┐
│  剧情推演室                                    │
│                                               │
│  ① 仿真模式选择                               │
│  [事件驱动] [自由涌现] [决策树] [混合]          │
│                                               │
│  ② 你的思路（可选）                            │
│  ┌─────────────────────────────────────┐      │
│  │ 输入你对剧情走向的想法或约束...       │      │
│  └─────────────────────────────────────┘      │
│                                               │
│  ③ 目标字数                                   │
│  (•) 10000字  ( ) 30000字  ( ) 50000字  ( )自定义│
│                                               │
│  ④ 提取章节数量                               │
│  最近 [10 ▼] 章                               │
│                                               │
│  [开始提取并生成框架]                          │
└─────────────────────────────────────────────┘
```

## 6. 全维度内容提取

### 6.1 提取维度

| 提取维度 | 数据来源 | 说明 |
|---------|---------|------|
| 角色完整特征 | `character-profile` + `character-aura`（光环）+ `character-cognition`（认知）+ `soul-doc`（灵魂）+ 拆书库角色 skill | 每个角色的性格、表达特征、心智模型、决策启发式、价值观、知道什么/不知道什么 |
| 章节内容 | `chapters/*.md` 正文 + `chapter-ingest.ts` 章节快照 | 已发生的剧情事实 |
| 记忆库 | `memory-center.ts`（7 类记忆）+ LanceDB 向量检索 | 结构化记忆 + 语义检索相关记忆，形成相辅相成 |
| 世界规则 | 大纲 + `canon-facts.md` 设定事实 | 世界观设定、规则体系 |
| 力量体系 | 大纲 + 角色状态 | 修炼等级、能力体系等 |
| 伏笔状态 | `foreshadowing-tracker.ts` | 已埋/已推进/已回收的伏笔 |
| 时间线 | `timeline.ts` | 事件时序关系 |

### 6.2 提取在后台进行，不阻塞用户操作

## 7. 故事框架

### 7.1 框架结构

```typescript
interface StoryFramework {
  id: string;
  premise: string;           // 前提：当前故事的起点（从已写章节提取）
  targetWords: number;       // 目标字数预算
  simulationMode: SimulationMode;
  userIdea?: string;         // 用户思路（可选）
  sourceChapters: number;    // 提取的章节数
  nodes: StoryNode[];        // 关键节点列表
  createdAt: string;
}

interface StoryNode {
  index: number;
  phase: '起' | '承' | '转' | '合';
  title: string;             // 节点名称
  coreConflict: string;      // 核心冲突/事件
  involvedCharacters: string[];
  goal: string;              // 该节点要推进的目标
  causeFromPrev: string;     // 与上一节点的因果关系
  expectedOutcome: string;   // 预期走向
}
```

### 7.2 框架生成逻辑

- LLM 分析已写内容的当前状态
- 结合用户思路（如有）调整方向
- 按目标字数决定节点数量（1万字≈3-4节点，3万字≈5-7节点，5万字≈8-10节点）
- 每个节点标注起承转合阶段
- 确保节点间因果链连贯
- 所有内容生成遵循小说写作结构

### 7.3 框架展示页面

```
┌─────────────────────────────────────────────┐
│  故事框架               [重新生成] [保存]    │
│                                               │
│  前提：当前故事进展到xxx，主角已yyy...         │
│                                               │
│  起 · 节点1：身份危机                          │
│    冲突：主角真实身份即将被揭穿                  │
│    角色：主角、反派、盟友                        │
│    目标：建立身份暴露的紧迫感                    │
│    起因：上一章反派的调查逼近                    │
│                                               │
│  承 · 节点2：被迫出走                           │
│    ...                                         │
│                                               │
│  转 · 节点3：盟友背叛                           │
│    ...                                         │
│                                               │
│  合 · 节点4：真相对决                           │
│    ...                                         │
│                                               │
│  [确认框架，开始推演]                          │
└─────────────────────────────────────────────┘
```

## 8. 仿真引擎

### 8.1 Agent 架构

```typescript
interface NovelAgent {
  // 身份（来自 QMAI 角色数据）
  characterId: string;
  name: string;
  profile: CharacterProfile;
  aura: CharacterAura;          // 光环：表达特征/心智模型/决策启发式/价值观
  cognition: CharacterCognition; // 认知：知道什么/不知道什么（信息边界）
  soul: CharacterSoul;           // 灵魂：人格深度

  // 状态（仿真中动态变化）
  currentGoal: string;
  emotionalState: string;
  knownFacts: Set<string>;
  relationships: Map<string, Relation>;
  powerLevel: string;
}
```

### 8.2 Agent 行为类型

```typescript
type AgentAction =
  | { type: 'speak', target?: string, content: string }
  | { type: 'act', content: string }
  | { type: 'react', target: string, content: string }
  | { type: 'decide', content: string }
  | { type: 'investigate', content: string }
  | { type: 'conflict', target: string, content: string }
  | { type: 'cooperate', target: string, content: string }
  | { type: 'withhold', content: string };
```

### 8.3 仿真核心循环

```typescript
async function* runSimulation(input: SimulationInput): AsyncGenerator<SimulationEvent> {
  const { agents, framework, mode, wordBudget, llmConfig } = input;

  for (const node of framework.nodes) {
    const activeAgents = agents.filter(a =>
      node.involvedCharacters.includes(a.characterId));

    for (let round = 0; round < maxRounds(node, wordBudget); round++) {
      for (const agent of activeAgents) {
        // 1. 构建决策上下文（角色特征 + 当前事件 + 图谱检索）
        const context = buildAgentContext(agent, node, currentEvents, graphRelevance);

        // 2. LLM 生成 Agent 行为决策
        const action = await llmDecide(agent, context, llmConfig);

        // 3. 应用行为效果（更新关系/认知/状态）
        applyAction(agent, action, allAgents);

        // 4. 产出仿真事件
        yield { type: 'agent-action', agent, action, round, node };
      }

      // 5. 检查节点目标是否达成
      if (checkNodeCompletion(node, events)) break;
    }

    yield { type: 'node-complete', node, stateChanges };
  }
}
```

### 8.4 四种仿真模式

| 模式 | 触发方式 | 仿真逻辑 | 输出 |
|------|---------|---------|------|
| 事件驱动 | 用户注入一个触发事件 | 事件发生 → 各角色反应 → 连锁效应 → 事件演化 | 该事件的多条演化路径 |
| 自由涌现 | 无特定事件，设定起始场景 | 角色根据目标自由互动 → 涌现冲突/合作 | 涌现的剧情走向 |
| 决策树 | 选定一个关键角色和决策点 | 为该角色生成多个选择 → 每个选择推演后续连锁反应 | 决策树（多分支对比） |
| 混合 | 先自由涌现 + 支持注入事件 | 自由互动中发现走向 + 关键点注入变量观察反应 | 多条可能分支 |

### 8.5 LLM 调用预算控制

```typescript
function calcSimulationScale(wordBudget: number) {
  return {
    maxNodes: Math.min(wordBudget / 5000, framework.nodes.length),
    maxRoundsPerNode: Math.max(2, Math.floor(wordBudget / 10000)),
    maxAgentsPerRound: Math.min(8, activeAgents.length),
    reportDetail: wordBudget > 30000 ? 'detailed' : 'summary'
  };
}
```

## 9. 推演报告

### 9.1 报告结构

```typescript
interface SimulationReport {
  frameworkId: string;
  mode: SimulationMode;
  characterAnalyses: CharacterAnalysis[];
  branches: StoryBranch[];
  recommendation: string;
}

interface CharacterAnalysis {
  characterId: string;
  name: string;
  behaviors: { node: string; action: string; motivation: string }[];
  stateChanges: string[];
  consistencyScore: number;  // 人设一致性评分(0-100)
}

interface StoryBranch {
  title: string;
  summary: string;
  keyEvents: string[];
  probability: 'high' | 'medium' | 'low';
  pros: string;
  cons: string;
  recommendation: boolean;
}
```

### 9.2 报告生成（ReACT 模式）

```
1. 规划报告大纲（2-4章节：角色分析 / 走向分支 / 综合推荐）
2. 逐章 ReACT：
   - Thought：分析当前需要回答什么
   - Action：调用检索工具
   - Observation：获取检索结果
   - 撰写该章节
3. 输出完整报告
```

检索工具复用 QMAI 现有的 `graph-relevance.ts`（图谱相关性检索）和 `search.ts`（向量检索）。

## 10. 故事草稿

```typescript
interface StoryDraft {
  branchId: string;
  chapters: DraftChapter[];
  totalWords: number;
}

interface DraftChapter {
  title: string;
  content: string;
  correspondingNode: number;
}
```

- 按框架节点逐个生成章节
- 每个章节参考该节点的推演结果
- 遵循 QMAI 的文风设置（如已启用文风）
- 总字数控制在用户选择的目标字数附近
- 草稿是参考性质，用户可编辑/采用/丢弃/导出

## 11. 故事框架保存与 AI 会话绑定

### 11.1 三栏布局对应

| 栏位 | 位置 | 内容 |
|------|------|------|
| 一栏（图标栏） | 最左侧 | 剧情推演室入口图标 |
| 二栏（侧边栏） | 图标栏右侧 | 故事框架列表（MD 文档，可多个） |
| 三栏（内容区） | 最右侧 | 选中框架后显示其推演结果列表 |

### 11.2 二栏：故事框架列表

```
┌──────────────────────┐
│ 故事框架              │
│ ───────────────────  │
│ 📄 主角身份线-框架    │
│   └ 推演结果1（事件驱动）│
│   └ 推演结果2（决策树）  │
│ 📄 反派复仇线-框架     │
│   └ 推演结果1（混合）   │
│ 📄 新故事线-框架       │
│                       │
│ [+ 新建故事框架]       │
└──────────────────────┘
```

- 每个故事框架保存为 MD 文档
- 一个框架下可以有多个推演结果（不同模式/不同参数）
- 点击框架 → 三栏显示推演结果列表
- 点击推演结果 → 三栏显示报告详情
- 用户可再次点击已保存的故事框架重新推演，减少 token 消耗

### 11.3 故事框架 MD 文档格式

```markdown
---
type: story-framework
title: 主角身份线-框架
createdAt: 2026-06-26
sourceChapters: 10
targetWords: 30000
simulationMode: event-driven
---

## 前提
当前故事进展到xxx，主角已yyy...

## 故事节点

### 起 · 节点1：身份危机
- **冲突**：主角真实身份即将被揭穿
- **角色**：主角、反派、盟友
- **目标**：建立身份暴露的紧迫感
- **起因**：上一章反派的调查逼近

### 承 · 节点2：被迫出走
...
```

### 11.4 AI 会话绑定

绑定流程：
```
用户在故事框架列表中选择一个框架
  ↓ 点击"绑定到 AI 会话"
弹出绑定对话框：
  ┌──────────────────────────────────┐
  │  绑定故事框架到 AI 会话            │
  │                                    │
  │  选择框架：[主角身份线-框架 ▼]      │
  │  生成章节数：[10 ▼] 章            │
  │                                    │
  │  绑定后，AI 会话将按此框架          │
  │  分析 10 章内容如何推动故事发展     │
  │                                    │
  │  [取消]        [确认绑定]          │
  └──────────────────────────────────┘
  ↓ 确认绑定
AI 会话中注入故事框架上下文
```

### 11.5 绑定后的 AI 会话行为

类似文风注入（`context-data-sources.ts` 注入），绑定故事框架后：

1. **章节分配**：AI 自动分析 N 章如何分配到各框架节点（如 10 章 → 起承转合各分配 2-3 章）
2. **上下文注入**：每次写章节时注入当前对应节点的冲突/角色/目标
3. **进度追踪**：AI 会话中显示当前写到框架的哪个节点
4. **可解绑**：类似文风，可随时取消绑定

### 11.6 存储结构

```
{project}/.qmai/simulations/
├── frameworks/
│   ├── framework-001.md          ← 故事框架 MD 文档
│   └── framework-002.md
├── results/
│   ├── framework-001/
│   │   ├── result-001.json        ← 推演结果（报告数据）
│   │   ├── result-001-report.md   ← 推演报告
│   │   ├── result-001-draft.md    ← 故事草稿
│   │   ├── result-002.json
│   │   └── result-002-report.md
│   └── framework-002/
│       └── result-001.json
└── bindings/
    └── active-binding.json       ← 当前绑定的框架+章节数
```

## 12. 与 QMAI 现有功能对接

| 对接点 | QMAI 现有模块 | 用途 |
|--------|-------------|------|
| 角色数据 | `character-profile.tsx` + `character-aura.ts` + `character-cognition.ts` | Agent 人格来源 |
| 灵魂系统 | `soul-doc.ts` | Agent 人格深度 |
| 世界设定 | 大纲 + `memory-center.ts` | 仿真世界规则来源 |
| 章节内容 | `chapters/*.md` + `chapter-ingest.ts` | 提取源 |
| 图谱检索 | `graph-adapter.ts` + `graph-relevance.ts` | Agent 决策时检索相关关系 |
| 向量检索 | LanceDB + `search.ts` | 语义检索相关记忆 |
| LLM 调用 | `llm-client.ts` + `model-resolver.ts` | Agent 决策 + 报告生成 |
| 伏笔状态 | `foreshadowing-tracker.ts` | 仿真变量注入 |
| 时间线 | `timeline.ts` | 时序上下文 |
| 文风注入 | `writing-style-store.ts` + `context-data-sources.ts` | 草稿生成时遵循文风 |
| 章节快照 | `chapter-ingest.ts` | 仿真结果可选写入 |

## 13. 不包含的范围（YAGNI）

- 不引入 Neo4j 或任何外部图数据库
- 不引入 Zep/Graphiti
- 不保留 MiroFish 的社媒仿真（OASIS）相关代码
- 不保留 MiroFish 的 Python/Vue 代码
- 不做实时仿真可视化（仿真过程不需要像 MiroFish 那样实时展示 Agent 动作）
- 不做 Agent 采访功能（MiroFish 的 IPC 采访模式）

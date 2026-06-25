# 角色一致性检查增强分支（jueseyizhixing）

## 分支用途

本分支用于增强深度章节生成流程中的"角色一致性检查"能力，解决 AI 会话生成章节时可能出现的以下问题：

1. AI 会话忘记某个角色（角色光环未注入）
2. 角色信息不匹配（characterStates 与 characterAuras 来源不同）
3. 审查阶段无法识别初稿中新出现的角色
4. 角色行为脱离记忆库设定但未被审查捕获

## 使用要求

- 本分支基于 master 分支创建，只增加"角色命中记忆库检查"能力
- 不修改无关代码，不删除已有函数
- 不破坏现有深度章节生成流程
- 修改完成后必须先跑源码验证，再跑旧功能测试，最后打包便携版

## 实现方案

采用方案 A + B 组合：

### 方案A：增强审查维度（修改 review-adapter.ts）

在现有 17 个审查维度基础上，新增"角色命中记忆库检查"维度，要求 LLM 在审查时：

1. 先从初稿正文中提取所有出现的角色名
2. 逐个对照 ContextPack 中的 characterAuras / characterStates / cognitionStates
3. 标注哪些角色"已命中记忆库"、哪些"未命中但应命中"
4. 判断角色行为是否脱离记忆库设定

### 方案B：审查前重新匹配角色光环（修改 deep-chapter-generation.ts）

在阶段4审查前，用初稿正文重新调用 `buildCharacterAuraContext`，把初稿中出现的角色光环补齐注入审查提示词，确保审查阶段能看到初稿新角色的完整光环。

## 修改文件清单

1. `src/lib/novel/review-adapter.ts` - 新增角色命中记忆库检查维度，增强审查提示词
2. `src/lib/novel/deep-chapter-generation.ts` - 审查前用初稿正文重新匹配角色光环

## 更新记录

### 20260620 - 初始实现

- 创建分支
- 实现方案A：在 review-adapter.ts 新增角色命中记忆库检查维度
- 实现方案B：在 deep-chapter-generation.ts 审查前重新匹配角色光环

## 提交状态

- [ ] 未提交 git
- [x] 已打包便携版（E:\QMAI\release-portable\QMaiWrite.exe）
- [ ] 未合并回 master

## 验证清单

- [x] 源码运行正常（typecheck 通过）
- [ ] 旧功能测试通过（深度章节生成流程正常）——待用户测试
- [ ] 新功能验证（审查阶段能看到初稿新角色光环）——待用户测试
- [x] 打包便携版成功

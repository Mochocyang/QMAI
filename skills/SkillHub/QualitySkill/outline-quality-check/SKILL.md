---
name: outline-quality-check
title: 大纲质量检查
description: Use when AI outline, chapter outline, character, setting, foreshadowing, or outline save requests need quality review before storage or follow-up generation.
---

# 大纲质量检查

## 适用范围

用于检查 AI 大纲体系中的题材卡、总纲、卷纲、章纲、人物小传、设定文件、伏笔文件和保存请求。不要生成正文。

## 必读标准

- `AI_OUTLINE_OUTPUT_PROTOCOL.md`
- `OUTLINE_FOLDER_STORAGE_STANDARD.md`
- `TicaiSkill/GENRE_ROUTE_STANDARD.md`
- `ZhanggangSkill/CHAPTER_OUTLINE_STANDARD.md`
- `JueseSkill/CHARACTER_PROFILE_STANDARD.md`
- `SheDingSkill/SETTING_PROFILE_STANDARD.md`

## 检查输出格式

```markdown
# 质量检查报告

## 检查对象
- 文件名：
- 文件类型：
- 引用 Skill：

## 结论
- 结果：通过 / 需修改 / 不通过
- 核心原因：

## 问题清单
| 序号 | 问题类型 | 位置 | 影响 | 修正建议 |
|---|---|---|---|---|

## 必改项
- ...

## 可选优化
- ...

## 保存建议
- targetFolder：
- fileName：
- writeMode：
```

## 题材卡检查

- 是否同时确认篇幅类型、受众方向、题材分类、用户灵感和目标输出。
- 是否区分男频/女频，没有使用男女频融合。
- 是否写出读者承诺、核心卖点、情绪缺口、最终满足。
- 是否说明大纲、章纲、人物、设定分别要怎么生成。
- 是否没有覆盖用户灵感。

## 总纲检查

- 主线目标是否只有一个主轴，支线是否服务主轴。
- 核心梗是否能循环，不是一两个桥段写完就结束。
- 主角欲望、缺陷、压力和成长是否能推动剧情。
- 反派或阻力是否分层，不是单一工具人。
- 设定是否服务冲突，不是资料堆砌。
- 题材承诺是否和用户选择一致。

## 章纲检查

- 文件名是否为 `章纲-第001章.md` 这类格式。
- 是否包含上章承接、本章定位、核心事件链、情绪曲线、角色状态、设定更新、伏笔、下一章交接。
- 核心事件是否有因果链，不是片段罗列。
- 本章是否有明确变化：信息变化、关系变化、目标变化、局势变化至少一项。
- 章尾是否有钩子或交接，不让下一章断开。
- 是否能直接给正文协作区读取使用。

## 人物检查

- 是否包含基本信息、角色定位、欲望、恐惧、信念、缺陷。
- 是否记录语言风格、关系网络、当前状态、出场记录。
- 是否说明角色在大纲和章纲中的功能。
- 反派是否有自洽动机，不只是作恶工具。

## 设定检查

- 世界观、力量体系、势力、地图、伏笔是否有边界、代价、限制和更新规则。
- 金手指是否有触发条件、消耗、风险、反制方式。
- 势力和地图是否能支撑阶段递升。
- 伏笔是否记录埋设位置、回收条件和回收章节。

## 保存协议检查

- 是否包含 `outlineSaveRequest` 或 `outlineSaveRequests`。
- 是否包含 `targetFolder`、`fileName`、`fileType`、`writeMode`、`referencedSkills`、`content`。
- `targetFolder` 是否符合文件夹保存规范。
- `writeMode=replace` 是否有用户明确授权。
- 是否把正文内容误存为大纲内容。

## 判定规则

- 通过：没有必改项，可以保存或进入下一步。
- 需修改：存在 1-3 个必改项，但主结构可保留。
- 不通过：题材路由错误、章纲不可执行、保存协议缺失，或生成了正文。

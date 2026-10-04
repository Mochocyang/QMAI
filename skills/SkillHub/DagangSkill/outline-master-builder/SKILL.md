---
name: outline-master-builder
title: 小说大纲总控
description: Use when the user wants to write genre fiction, serial fiction, or a novel outline and needs AI to guide them from a rough idea to a usable complete outline. Also use when the user says 大纲, 小说大纲, 网文大纲, 开书, 设定太乱, 不知道怎么写大纲. Do not use for pure summary, literary critique, or editing finished prose.
---

# Novel Outline Builder

## Core Principle

Guide the user through a low-burden outline workflow. Do not dump a large template. Build the outline in order: plot seed, selling point, goal ladder, character fit, supporting cast, worldbuilding, final assembly.

## Required Sub-Skills

Use these skills in order:

1. `story-plot-seed`
2. `story-selling-point`
3. `story-goal-ladder`
4. `protagonist-plot-fit`
5. `outline-supporting-cast`
6. `worldbuilding-outline-last`
7. `outline-final-assembler`

If the environment cannot load sub-skills automatically, follow their documented steps manually in the same order.

## Workflow

1. **Collect the minimum premise**
   - Ask for genre, protagonist seed, desired tone, and any must-have idea.
   - If the user has no idea, offer 3 concise premise options and let them choose.

2. **Run each step once**
   - Keep intermediate outputs visible.
   - Do not skip to worldbuilding.
   - Do not create chapter-by-chapter detail until the outline is assembled.

3. **Merge only after all components exist**
   - The final output must include: title placeholder, one-sentence hook, 500-word plot skeleton, selling point, staged goals, protagonist, supporting cast, worldbuilding rules, and golden-three-chapter readiness.

## Output Contract

Produce a complete outline in Chinese unless the user asks otherwise:

- 作品暂名
- 类型和读者预期
- 一句话钩子
- 剧情骨架
- 核心卖点
- 阶段目标
- 主角人设
- 关键配角
- 世界观设定
- 黄金三章开篇检查
- 仍需作者确认的问题

## Guardrails

- Do not turn the request into a generic writing lecture.
- Do not make the user fill a huge form.
- Do not start with world history, power levels, maps, or long lore.
- Do not invent extra complexity if the user only needs a practical first outline.

## Source Trace

From `大纲如何写.mp3`: “剧情，加卖点，加人设，加目标，加世界观，每一步只需要几百字” and “做完以上的步骤后，你们就可以开始写黄金三章了。”


# P6：章节链路补 system（规则不再逐阶段重发）

日期：2026-10-25
范围：章节深度生成链路（任务书 / 草稿 / 扩写 / 返修 / 阶段6 / 审稿）

---

## 1. 问题

章节链路此前**完全没有 system 消息**。`collectModelText` 只发 `[{ role: "user", content: ... }]`，
所有"引擎级规则"（反 AI 腔硬约束 904 字 ≈ 226 token）被拼在各阶段 user 提示词的**中段**：

```
[user] 作品大纲 + 上下文包（P，跨阶段相同）
       + 阶段指令（"你是小说正文写作助手…"）   ← 每阶段都不同
       + 硬性要求 1..N
       + 反 AI 腔规则块                        ← 断点在这里之后 → 每阶段全价重发
       + 章节号 / 用户请求 / 任务书 / 初稿
```

前缀缓存只认"从第 0 个字节起连续相同"的部分。P 能命中，但规则块排在阶段指令之后，
**每个阶段都要重新付一次全价**。

---

## 2. 改动（3 个源文件 + 4 个测试文件）

| 文件 | 改动 |
|---|---|
| `deep-chapter-prompts.ts` | 新增导出常量 `CHAPTER_SYSTEM_PROMPT`（1167 字 ≈ 292 token）：通用纪律 4 条 + 反 AI 腔规则本体。三个 builder（草稿/扩写/返修）移除各自的规则块 |
| `deep-chapter-generation.ts` | `applyCachePrefix` → `withChapterRequestFrame`：在拆前缀块的同时前置 system；4 处 `reviewChapter` 调用补 `cacheSystemPrompt` |
| `review-adapter.ts` | `ReviewChapterOptions` 加 `cacheSystemPrompt`；有前缀时若给了 system，就发 `[system: 同一份] + [user: 前缀块 + 审稿文案]` |

改后结构：

```
[system: 引擎纪律 + 反AI腔规则]      ← 跨阶段、跨章逐字节相同
[user:   P（大纲+上下文） ][块边界 cacheControl]
         + 该阶段专属指令与素材      ← 唯一变化
```

---

## 3. 一个必须一起处理的依赖（否则前功尽弃）

**审稿请求必须带同一份 system。** 写作是 `[system: S][user: P+指令]`，
审稿若还是 `[user: P+审稿文案]`，两者第 0 个字节就不同，P2/P1 挣来的 99% 命中会全部归零。

受控实验（唯一 nonce 保证全新内容，硅基流动 DeepSeek-V4.1）：

| 请求 | prompt | cached | 命中 |
|---|---|---|---|
| A 无 system（冷） | 4632 | 0 | 0.0% |
| B **有** system（同一份正文） | 4937 | 0 | **0.0%** |
| C 又有 system | 4937 | 4864 | 98.5% |
| D 回到无 system | 4632 | 4608 | 99.5% |

B=0% 是关键：**只加 system、正文一字不改，缓存照样清零**。所以这是硬约束，不是优化建议。

D=99.5% 还顺带说明：provider 的前缀缓存按内容长期保留（跨请求、跨会话），
所以判断"是否冷启动"必须用 nonce，不能用"我以为它是新的"。

---

## 4. 一个副作用，我改了实现方式而不是改语义

反 AI 腔规则原本**故意**不注入阶段 6（润色）——提交 42727a9 的理由是：
阶段 6 只该按剩余问题清单局部改，喂它去 AI 腔规则会触发大范围改写。

规则升到 system 后成了全局约束，这个保护就消失了。

**我第一版的做法是错的**：给阶段 6 的 user 提示词加了一句边界句。
这会直接推翻 42727a9 的护栏（`deep-chapter-generation.spec.ts` 里两条断言就是钉这个的）。

**最终做法**：把边界写成 system 里的**条件句**，不进任何阶段提示词：

```
3. 若当前阶段只要求在指定问题范围内做局部修改，这些约束只在点名范围内顺带满足，
   不得据此改写范围之外的段落、剧情或人物关系。
```

这样阶段 6 收到的是"规则 + 适用范围有限"，而不是"规则 + 大范围重写授权"，
同时 `polish` 的 user 提示词仍不含任何规则相关文案，42727a9 的护栏原样保留。

---

## 5. 真机验收（硅基流动 DeepSeek-V4.1，system 1167 字 / 前缀 9196 字）

| 请求 | prompt | cached | 命中 |
|---|---|---|---|
| 1 任务书（带 system·冷） | 6295 | 0 | 0.0% |
| 2 草稿（同 system + 同前缀） | 6300 | 6272 | **99.6%** |
| 3 审稿（同 system + 同前缀） | 6297 | 6272 | **99.6%** |

从任务书到草稿到审稿，三个不同角色、不同指令，共享 `system + P` 整段，
未命中只有各自新增的那几十个 token。

复跑命令见文末。

---

## 6. 收益（如实说，这一轮不大）

| 项 | 数值 |
|---|---|
| 规则块 | 904 字 ≈ 226 token |
| 每章 `collectModelText` 调用 | 常见 4~5 次（任务书/草稿/扩写/返修/润色） |
| 旧：规则每次全价 | 226 × 5 ≈ **1130 token** |
| 新：一次落盘 + 命中价 | ≈ 226 + 226×4×0.1 ≈ **316 token** |
| 每章节省 | **约 800 token** |

按 DeepSeek 定价换算，一章省的钱很少。**这一轮的真实价值不是这 800 token**，而是：

1. 章节链路终于有了 system 这个位置——"引擎级、跨阶段、跨章不变"的内容有了归处；
2. 与主对话链路（P0 已补 system）结构对齐，两条链路的缓存语义一致，后续改动不会互相打架；
3. 顺手定死了"写作与审稿必须共用同一份 system"这条不变量，并写进 `S10` 护栏。

---

## 7. 局限与未做

1. **只测了硅基流动一家**。`2048 token 门槛`、`128 块粒度`、system 对前缀的影响，
   在 `api.deepseek.com` 官方端点未验证。
2. 没有真实跑一整章（`max_tokens=8`），所以"模型看到新 system 后写作质量是否变化"未验证。
   建议试读 1~2 章，重点看：是否还有 AI 腔、阶段 6 是否出现超范围改写。
3. `brief`（任务书）阶段也带了 system 里的反 AI 腔规则。任务书是内部规划文档，
   规则对它的作用应无害，但也没有实测。

---

## 8. 验收与复跑

- `tsc --noEmit -p tsconfig.app.json` 干净
- `src/lib/novel` 3797 项通过
- `novel + __tests__ + chat + context-hub + agent` 4756 项通过 / 6 todo

新增/翻转的护栏：

| 测试 | 作用 |
|---|---|
| `deep-chapter-prompts.cache.spec.ts` | 所有阶段 user 不再含规则块；`CHAPTER_SYSTEM_PROMPT` 含规则且为纯静态 |
| `deep-chapter-prompts.spec.ts` | 三个阶段 user 不含规则；任务书/阶段6 不含规则；阶段6 的 `user` 仍不含边界句 |
| `review-adapter.spec.ts` | 带 `cacheSystemPrompt` 时 `[system: 同一份][user: 前缀块]`，且只有一条 system |
| `__tests__/cache-prefix-diagnostic.spec.ts` S10 | 成对携带 99.9%，不成对 0.0% |
| `deep-chapter-generation.spec.ts` | `messagesPromptText` 跳过 system（否则 mock 会因 system 里的"返修/正文"字面误判阶段，17 条用例一起挂） |

复跑命令：

```bash
"C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" \
  ./node_modules/vitest/vitest.mjs run src/lib/novel src/lib/__tests__ \
  src/components/chat src/lib/context-hub src/lib/agent
```

真机复核：`.codex-temp/chapter-frame.json`（由 `CHAPTER_SYSTEM_PROMPT` + 真实
`contextPackToPrompt` 生成）可直接按上面第 5 节的三种 messages 形态重发。

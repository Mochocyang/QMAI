# 删除档案文档左侧的「分区导航」

**需求（用户原话）**：「如图 关于大纲左侧的分区导航删除了 不需要。。。」

**结论**：左侧那一栏已**真正删除**（不是显示层藏起来）。8 个档案模板的 `<aside class="profile-rail">` 与它的样式整块去掉、版面改回单栏；
生成器不再产出这部分内容；用户已有的 7 个档案 `.html` 也一并清掉了烤进去的那一栏（原件已备份）。

产物：`release-portable/QMaiWrite.exe` SHA `0d788923`（213,587,456 B）、NSIS `青幕AI写作_4.1.2_x64-setup.exe` SHA `224becd2`；
时间线 dist 22:50:53 → exe 22:58:57。

---

## 1. 改之前先分清「这是哪一族导航」

用户说「大纲左侧的分区导航」。仓库里有两族长得像、但完全不同的东西：

| 族 | 位置 | 形态 | 本次处理 |
|---|---|---|---|
| **档案文档**（人物小传/势力/伏笔/地理/地点/力量体系/金手指/背景） | `.profile-layout` 的**左栏 200px** | `<aside class="profile-rail">` 内 `<nav class="pnav">`，标题「分区导航」，纵向 sticky 列表 | **删除** |
| 卷纲 / 章纲 | 正文顶部 | `<nav class="nav">`，标题「跳到故事」，**横向胶囊条** | 不动（不是用户指的） |

截图里被红框圈出的正是第一族的左栏，所以只动第一族。

## 2. 删的是真东西，不是藏起来

**动的是 8 个模板**（`skills/SkillHub/**`）：

- `JueseSkill/character-design/profile.html`
- `SheDingSkill/world-rules/background.html`
- `SheDingSkill/power-system/profile.html`、`power-system/golden-finger.html`
- `SheDingSkill/faction-system/profile.html`
- `SheDingSkill/foreshadowing-suspense/profile.html`
- `SheDingSkill/map-progression/profile.html`、`map-progression/location.html`

每个文件删 20 条规则，改动完全同形：

1. 整块删 `<aside class="profile-rail" aria-label="分区目录">__PROFILE_OVERVIEW__</aside>`；
2. 删 20 条只服务于左栏的 `.profile-rail` / `.pnav` 规则；打印规则里并列的
   `.document-top,.profile-rail{display:none}` 只摘掉导航那一个，保留 `.document-top`；
3. 删掉只剩它一个人用的 `--rail-bg` 令牌；
4. 版面 `200px minmax(0,1fr)`（桌面）与 `166px minmax(0,1fr)`（≤1080px）→ `minmax(0,1fr)` 单栏；
5. **顺手修掉一处既有缺陷**：第 93/94 行是两行**孤立的** `@media (max-width:1080px){`
   （重复且未闭合，此前全靠浏览器容错）。删后花括号才 222/222 配平。

改动的**唯一源真相**就是这 8 个文件：各 `*-template.ts` 用 `?raw` 直接导入它们，
且三个项目里都没有 `.qmai/*模板.html` 覆盖（已核实）。

**生成器**（`src/lib/novel/profile-document.ts`）：

- `buildOverviewHtml()` 改为返回空串；
- `overview` 从 `REQUIRED_PLACEHOLDERS` 移除。

`overview` 占位符**保留映射**是有意的：用户自定义模板（`.qmai/人物小传模板.html` 等）里若还留着
`__PROFILE_OVERVIEW__`，会被收成空串而不是把占位符原文漏到页面上。已加测试钉住这条。

**为什么不写 `display:none`**：那属于「藏起来」。用户上一轮正是因为我在显示层做手脚才要求重修的
（`b958402` 被否），所以这里是真的把元素与样式删掉了。

## 3. 已有文件：为什么必须处理，以及怎么处理的

`preview-panel.tsx` 的规则是「**磁盘上有同名 `.html` 就直接用它**，
只在没有伴生文件时才按新模板即时渲染」，所以只改生成器，用户已有档案仍会显示左栏。
用户选择「一并清掉」。

清两类（第 7 个文件起初没列进来，理由见 §4）：

| 文件 | 形态 | 处理 |
|---|---|---|
| 楚白 2 个 + 黑雨之下 4 个 | `<aside class="profile-rail">` 左栏 | 删整行 + 删失效样式 + 200px/166px 改单栏 |
| 黑雨之下 `设定-第二卷及后续战场地理设定集.html` | **老格式「地理卡」**：`.panels` 里横向胶囊条 | 删 `<section class="panels">` 整块 + 删 `.pnav`/`.panels` 样式 |

守卫（改前逐项快照，改后必须逐项相同）：

- 分区卡片数与 **`id="psec-N"` 列表完全一致** —— 证明正文一个字没动；
- 花括号增减成对；
- 改完不得残留 `profile-rail` / `pnav` / `panels` / `navlink` / `__PROFILE_OVERVIEW__`；
- `.kv` 的 `78px minmax(0,1fr)`（字段标签列，长得和版面左栏一样）**必须健在** ——
  这条守卫抓出过我第一版的误删。

原件备份在 `.codex-temp/backup-existing-rail-20261009-rail-cleanup/`。
逐项比对结果见 `evidence/01-已有文件-与备份逐项一致.txt`。

## 4. 我自己踩的坑（两处，都记下来）

### 4.1 用正则删 CSS 规则，把 `.hero` 的底色一起删了

第一版写的是 `\.profile-rail[^{},]*\{[^{}]*\}`。在 `.profile-rail .pnav{…}` 上翻车：
`.pnav{…}` 被上一步（`\.pnav{}` 规则）先删掉后，残留的 `.profile-rail ` 前缀**没了自己的 `{`**，
于是 `[^{},]*` 跨过 6 个换行连到了后面第一个 `{` —— 正好是
`.hero{background:linear-gradient(…)}`，把封面区底色整条带走。

是测试当场抓住的：`.hero 没有声明 background: expected null not to be null`。

**教训**：删 CSS 要按「**规则**」这个单位删，不能让选择器片段悬空之后再去匹配。
现在改成先把样式表扫成一条条完整规则、命中的整条按字面量替换，
并加了两道守卫：「关键规则必须原样健在」（`.hero` 底色、`.kv` 标签列、打印隐藏页眉、正文容器…）
与「不得出现悬空选择器」。

### 4.2 差点把「老格式地理卡」漏掉，是判别脚本救回来的

我最初的处置口径是「删 `<aside class="profile-rail">` + 200px 改单栏」，
于是老格式那个文件（没有 `<aside>`、没有 200px 分栏）被判为「不属于这一族」，没动它。

但真机脚本给出了硬证据。做法是拿它当**判别器**：
它的同名 `.html` 是老格式（有 `<main class="profile">`、有 `.panels` 横向导航、
没有 `.profile-main`），而内置模板渲染出来的一定有 `.profile-main`。
打开它实测：`.panels=1 .pnav=1 「分区导航」字样=true`、`main.profile=1`、`.profile-main=0`
→ 既证明 App 确实在读磁盘伴生 `.html`（而不是只走模板兜底），
也证明**用户在界面上还看得见一条「分区导航」**。于是把它一并清掉，复验后
`.panels=0 .pnav=0 「分区导航」字样=false`。

同一轮里这个脚本自己也有一个 bug 值得记：帧过滤条件写成 `q("main")>0`，
把**主页面帧**也算了进来（它当然有 `<main>`），于是报出「0 个卡片、判别器失效」的假象。
改成必须 `q(".pcard")>0` 后正常。**判据要盯住目标特有的东西，不能盯一个到处都是的东西。**

## 5. 验收

### 5.1 单元 / 类型

- 聚焦 14 个文件 **231/231 通过**；
- 全量 **722 个文件 6943 通过**（唯一失败见下）；
- `typecheck`、`typecheck:tests` 均 **exit 0**。

全量里唯一的失败是 `scripts/refine-acceptance.real-llm.test.ts`：
它 `import { … hasOutlineForRefinement } from "@/lib/novel/outline-generation"`，
而该模块**根本没有导出这个名字**（全仓只有这条 import 与 `changelog.ts` 里的历史说明）。
`outline-generation.ts` 本次未被改动 —— 这是**既有的损坏脚本**，与本次改动无关，如实记下、未掩盖。

被改动的测试及其理由：

| 测试 | 原断言 | 现在 |
|---|---|---|
| `outline-editorial-v2.spec.ts` ×8 模板 | 含 `class="profile-rail"`、`position:sticky` | 断言**不得**含左栏元素/`pnav`/占位符，且版面必须是单栏 |
| 同上（地理保存链路） | `.profile-rail nav` 非空 | `.profile-rail`/`.pnav` 为 null，且正文卡片数、标题、图例都在 |
| 同上（旧自定义模板） | 只断言无残留占位符 | 补一条**反向容忍**：模板里留着 `__PROFILE_OVERVIEW__` 也不得漏占位符、不得出现「分区导航」 |
| `faction-profile-template.spec.ts` ×2 | 借导航里的「1 个分区」/「11 个分区」计数 | 直接数 `class="pcard"` 的个数 |
| `html-document-appearance.spec.ts` | fixture 用 `.profile-rail`/`.pnav` | 换成卷纲的「跳到故事」胶囊 —— 该测试真正要保的是「srcdoc 里页内锚点能跳」，那个能力对卷纲/章纲仍然必要 |
| `--rail-bg` 令牌 | 模板必须定义并用到 | 从模板清单移除；**注入样式表仍保留声明**（旧 `.html` 里还写着 `var(--rail-bg)`，不声明会拿到空值），并加注释说明这不是漏删 |

### 5.2 真机（新 SHA `0d788923`）

必须覆盖**两条读取路径**，只验一条会漏另一条：

| 样本 | 路径 | 结果 |
|---|---|---|
| `角色-角色-林小满.md` | 有伴生 `.html` → 读磁盘那份 | `.profile-rail=0 .pnav=0` 「分区导航」字样=无；单栏；10 个分区卡片 |
| `角色-角色-杨寒.md` | 无伴生 → **内置模板即时渲染** | `.profile-rail=0 .pnav=0` 「分区导航」字样=无；单栏；11 个分区卡片 |
| `设定-第二卷及后续战场地理设定集.md` | 老格式伴生 `.html` | 判别为「磁盘伴生」；清理后 `.panels=0 .pnav=0` |

预览 iframe 是 `sandbox=""`（不透明源），父页面拿不到 `contentDocument` →
改用 Playwright 的 `page.frames()` 逐帧求值。

**既有验收同样重跑（新 SHA 必须重跑，这是规矩）**：

- 分层跟随率：chrome **2514/2514 = 100.0%**、content **0/51 = 0.0%** ——
  与上一版验收**逐项相同**，说明本次改动没有碰到排版路径；
- 默认档 10/10 逐位还原、正文与界面字号解耦 5/5；
- 设置保存 8/8 字段，且证据 `exeSha256 = 0d788923…`；
- 浮层四项布局事实全部成立 + 两张截图重新归位；
- 用户 8 个排版字段与跑前快照**完全一致**（外壳状态已还原为 楚白 / 章节）；
- `body-font-scale.json` 对新 dist 重跑（`distIndexMtime = 2026-10-09T14:50:53.675Z`，verdict pass，guardsFailed 0）；
- `check-all.mjs --delivery` **exit 0**。

### 5.3 一次调用方式的教训（不是代码缺陷）

第一次跑 `verify-real-exe.mjs --attach` 时报了两条红：
「编辑器 DOM 未挂载」与「content 层参与元素仅 0 个」。

原因是当时界面停在**「大纲」视图**（我刚跑完抽屉脚本），主区域换成了知识树 + 预览、
编辑器已卸载，于是正文层分母为 0。**「无从判定」不等于「通过」，脚本这条判据是对的。**
正确姿势是先切到「章节」并打开一章让编辑器挂载
（工具：`.codex-temp/open-chapter-view.cjs`），重跑即 2514/2514 + 51 个 content 元素 ——
与上一版完全一致的数字。

## 6. 本轮脚本

| 脚本 | 用途 |
|---|---|
| `.codex-temp/remove-profile-rail.mjs` | 改 8 个模板（预演/`--apply`，带 6 类硬守卫） |
| `.codex-temp/clean-existing-profile-files.mjs` | 清 6 个已有文件的左栏（自动备份 + 逐项守卫） |
| `.codex-temp/clean-legacy-geo-card-nav.mjs` | 清老格式地理卡的横向导航 |
| `.codex-temp/verify-existing-profile-files.mjs` | 与备份逐项比对（jsdom 真解析） |
| `.codex-temp/verify-profile-rail-removed.mjs` | 真机：两条读取路径都无左栏 |
| `.codex-temp/discriminate-companion-vs-template.mjs` | 真机：磁盘伴生 vs 内置模板判别 |
| `.codex-temp/open-chapter-view.cjs` | 切到章节并打开一章，让编辑器挂载 |

## 7. 证据文件

`evidence/` 下：

- `01-已有文件-与备份逐项一致.txt` —— 6 个文件的分区卡片数与标题逐项比对
- `02-模板改动幅度.txt` —— 本轮提交的改动统计
- `03-真机-档案两条路径无左栏.json` —— 真机观测（含完整转录）
- `04-真机-老格式地理卡-走磁盘伴生且已无导航.json` —— 判别器输出
- `05-真机-档案文档无左栏.png` —— 截图：正文满宽、左侧无栏

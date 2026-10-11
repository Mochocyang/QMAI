# QMAI 捆绑字体授权核验 / Bundle Font License Verification

**唯一判定标准 / The only test:** 不是「能否免费使用」，也不是「能否免费商用」，而是——
**「许可证是否明确授权把字体文件本身再分发、并打包进第三方商业闭源产品的安装程序？」**

## 为什么这一条必须比「免费商用」更严

厂商宣传「免费商用」时，说的是**你用字体做出来的作品**可以商用（小说封面、logo、App 界面），
**不是**字体文件可以随你的安装包一起传播。中文字体领域这两件事被混为一谈是常态，
而混为一谈的后果是把侵权风险写进安装包。本报告用**逐字原文**把两类区分开：

已被此陷阱挡下的两款（都对外宣称「免费商用」）：

| 字体 | 厂商宣传 | 授权动词逐字 | 结论 |
|---|---|---|---|
| MiSans（小米） | 免费商用 | 「安装、使用 / install and use」；禁止「不得**单独**将 MiSans 字体…进一步分发」 | ❌ 灰区，未获书面确认前不得捆绑 |
| 阿里巴巴普惠体 | 免费商用 | 「可以**下载、安装和使用**」；兜底禁止「采取其他未经阿里巴巴明确授权的行为」 | ❌ 不可捆绑 |

> 普惠体的兜底条款逐字为：「未经阿里巴巴书面授权，任何人不得：…3）将阿里巴巴字体进行单独定价出售、出租、出借、转让、转授权、**或采取其他未经阿里巴巴明确授权的行为**」。
> 授权里**没有任何** embed / bundle / redistribute 动词，而兜底条款把「未明确授权」的行为一律禁止 ⇒ 捆绑再分发落入禁止范围。

## 核验方法与可复跑性

本报告的每一条结论都由脚本产出，**任何人都能重跑复核**：

```bash
# ① 先验尺子：解析器自检 14 项（8 段真实许可片段 + 6 项内容闸门）
node docs/font-license-verification/verify-bundle-licenses.mjs --selftest

# ② 再量字体：25 款候选全量核验
node docs/font-license-verification/verify-bundle-licenses.mjs --json docs/font-license-verification/license-verification.json
```

- 退出码：`0` = 全部候选均已核实；`1` = 存在 UNVERIFIED（一律按不可捆绑处理）；`2` = 脚本自身故障（网络全断 / 自检不过）。
- 本机 `web_search` / `web_fetch` 不可用，全程用 `curl.exe`；每个候选配**离线证据回落**（`.font-research/evidence/`），故网络抖动不会产生假 UNVERIFIED。
- 净结果：**候选 25 款 → 可捆绑 23 / 明确不可捆绑 2 / 需人工判定 0 / 未能核实 0**（退出码 0）。

### 工具自身防的四类「假证据」

这四类都是核验过程中**真实踩到**的，不是想象出来的。一个只会说「没问题」的检查器比没有检查器更危险。

| # | 陷阱 | 真实表现 | 防线 |
|---|---|---|---|
| ① | **仓库根 LICENSE 骗人** | `huawei-fonts/HarmonyOS-Sans` 根 LICENSE = **GPL-3.0**（那是 npm 包装脚本的许可，不是字体许可）→ 会把字体**误判成 GPL 而误拒**；`welai/glow-sans` 根 LICENSE = **MIT**（构建代码），字体才是 OFL → 会**漏掉 OFL 随附义务** | 同时抓「许可文件」与「仓库根 LICENSE」，不同源即报警 |
| ② | **HTTP 200 但不是许可** | 语雀普惠体页面返回 200、45 KB，内容是**验证码墙 + JS 配置**（`captchaConfig`…），零授权动词 | 内容闸门：不像许可即回落离线证据，并记录被拒内容 |
| ③ | **OFL 样板文字被误当 RFN 声明** | 每份 OFL 都有 `"Reserved Font Name" refers to any names specified as such after the copyright statement(s).` —— 这是**定义**，不是声明 | RFN 只在 OFL 正文**之前**的版权区里找 |
| ④ | **贪婪匹配吞掉整段正文** | LXGW 许可的第二处 "Reserved Font Names" 要把 ADDITIONAL PERMISSION 整段吞进来（实测抓出 130+ 字符的"字体名"） | 非贪婪 + 首个句末截断，并由自检钉死 |

## 一、可捆绑清单（23 款，含一手证据）

### A. OFL-1.1 系（22 款）—— 随附 OFL 全文 + 版权行即可

| 字体 | 版权行 | 保留字体名（RFN） | 备注 |
|---|---|---|---|
| 霞鹜文楷 LXGW WenKai | `Copyright 2021-2026 LXGW …, with Reserved Font Name '霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩' and 'LXGW'` | 霞鹜 / 霞鶩 / 落霞孤鹜 / 落霞孤鶩 / LXGW | 用户点名「霞」。正文楷体首选 |
| 霞鹜文楷 GB | `Copyright 2022-2026 LXGW …` | 同上 5 个 | 简体字集更全 |
| 霞鹜文楷屏幕阅读版 | `Copyright 2021-2026 LXGW …` | 同上 5 个 | 屏幕优化，长文阅读更清晰 |
| 霞鹜文楷 TC（繁体） | `Copyright 2022-2026 The LXGW WenKai Project Authors` | **未声明** | 改名义务较宽松 |
| 朱雀仿宋 Zhuque Fangsong | `Copyright (c) 2023, Zhejiang JadeFoci Techonology Co. LTD` | **未声明** | 体积最小（5.5 MB），正文首选 |
| 文津宋体 WenJinMincho | `Copyright (c) 2024-2026, Takushun Wu …, with Reserved Font Name 'WenJin Mincho', '文津宋体', '文津宋體', '文津明朝', '문진(文津) 명조'` + Adobe `'Source'` | WenJin Mincho / 文津宋体 / 文津宋體 / 文津明朝 / 문진(文津) 명조 / Source | 大字符集宋体，冷僻字覆盖好 |
| SuperHan | `Copyright (c) 2024, Takushun Wu …, with Reserved Font Name SuperHan` | SuperHan | **旧报告标为「未抓到」，本次已补齐** |
| 寒蝉正楷体 ChillKai | `Copyright 2023 The ChillKai Project Authors` | **未声明** | 用户点名「楷」 |
| 寒蝉全圆体 ChillRound | `© 2023 ChillType, with Reserved Font Name 'ChillRoundF' 'ChillRoundM'` | ChillRoundF / ChillRoundM | 版权行用 `©` 而非 `Copyright` |
| 悠哉字体 Yozai | `Copyright 2020, 2024 LXGW …` | **未声明** | |
| 芫荽 Iansui | `Copyright 2025 The Iansui Project Authors …` | **未声明** | 繁体向 |
| 得意黑 Smiley Sans | `Copyright (c) 2022--2024, atelierAnchor …, with Reserved Font Name <Smiley> and <得意黑>` | Smiley / 得意黑 | RFN 用**尖括号** |
| 更纱黑体 Sarasa Gothic | `Copyright (c) 2015-2025, Renzhi Li …` + Adobe `'Source'` | Source | 标题写作 `SIL Open Font License v1.1`（非标准写法） |
| 未来荧黑 Glow Sans | — | **未声明** | ⚠️ 仓库根 LICENSE 是 MIT，**字体才是 OFL**（陷阱①） |
| 思源黑体 Source Han Sans | `Copyright 2014-2025 Adobe …, with Reserved Font Name 'Source'` | Source | RFN 声明**跨两行** |
| 思源宋体 Source Han Serif | 同上 | Source | |
| Noto Sans CJK | 该 LICENSE 为**纯 OFL 文本、无版权行** | **未声明** | 版权信息在字体元数据内，须另行记录 |
| Noto Serif CJK | 同 Sans（两份 LICENSE 实测**字节相同**） | **未声明** | |
| Noto Sans SC（Google Fonts 发布版） | 含 Adobe 版权行 | Source | |
| Maple Mono | — | **未声明** | 等宽，适合代码块 |
| 昭源黑体 Chiron Hei HK | — | **未声明** | ⚠️ 该项目**无任何 release 资产**，只能源码构建 ⇒ 不可确定性下载，**暂不进捆绑清单** |
| 抖音美好体 Douyin Sans | 含 RFN `Douyin / 抖音 / 抖音美好` | Douyin / 抖音 / 抖音美好 | 字节跳动开源 |

### B. 专有但明确允许捆绑（1 款）

| 字体 | 授权动词逐字 | 硬性条件 | 风险 |
|---|---|---|---|
| 鸿蒙黑体 HarmonyOS Sans SC | `use, copy, merge, embed, bundle, redistribute and/or sell unmodified copies of HarmonyOS Sans Fonts with any software except for fonts software` | ①**显著注明**使用了 HarmonyOS Sans；②**不得作任何修改**（⇒ 不得子集化 / 格式转换 / 改名）；③不得作为字体产品单独再分发；④保留版权声明与协议全文 | 许可为 non-transferable 且 **revocable（可撤销）** ⇒ 持续性风险，**须法务登记** |

> ⚠️ 陷阱①：该仓库根 LICENSE 是 **GPL-3.0**，那是仓库 npm 包装脚本的许可，**不是字体许可**。
> 字体真正的许可是官方 ZIP 内 `HarmonyOS_Sans_SC/LICENSE.txt`（已存 `.font-research/evidence/HarmonyOSSans_SC_LICENSE_utf8.txt`，SHA-256 `785B86C6…`）。

## 二、拒绝清单（2 款）

| 字体 | 性质 | 决定依据（逐字） |
|---|---|---|
| MiSans（小米） | ❌ **有歧义的灰区**（非明文禁止） | 禁止「不得**单独**将 MiSans 字体或其组件对外租赁、再许可、给予、出借或进一步分发」；但条件 1) 又要求「您应在**软件中**特别注明使用了 MiSans 字体」。限定语「单独」+ 软件内使用的暗示 ⇒ 灰区。**工程结论：不捆绑**（除非取得小米书面确认） |
| 阿里巴巴普惠体 3.0 | ❌ **明确未授权** | 授权仅「可以**下载、安装和使用**」；兜底禁止「采取其他未经阿里巴巴明确授权的行为」。**无任何再分发/嵌入授权**，且**没有**类似 MiSans 的软件内使用暗示 ⇒ 比 MiSans 更明确地不可捆绑 |

### 按类别整体排除（不逐个核验）

| 类别 | 排除理由 |
|---|---|
| 方正、汉仪系列 | **嵌入/捆绑是单独定价的许可项**（`founder_business_license.html` / `hanyi_license.html` 已存证），免费下载 ≠ 可嵌入 |
| 文泉驿**正黑** | GPL-2 + 字体嵌入例外——该例外覆盖**文档**，不覆盖**软件分发** |
| 霞鹜新晰黑 / 新致宋 / 晰黑 / 致宋 / 尚智黑 / 铭心宋 | **IPA Font License 1.0**：要求为使用者提供「替换回原版 IPA 字体」的途径，对闭源安装包不现实 |

## 三、已核实但**不进捆绑清单**的字体

| 字体 | 许可 | 不进清单的原因 |
|---|---|---|
| 昭源黑体 Chiron Hei HK | ✅ OFL-1.1 | 项目**无任何 release 资产**，只能源码构建 ⇒ 无法确定性下载 + 校验哈希。若将来发布 release 可重新评估 |

## 四、捆绑时必须同时履行的手工义务

工具能机械核验「许可允许捆绑」，但**不能替你履行义务**。以下每一条都要在 Phase 4 落地：

1. **随软件附带许可全文**：每款 OFL 字体都要附 OFL-1.1 全文 + 该字体的版权行（版权行已逐条列于上表）。
2. **鸿蒙黑体的显著注明**：安装界面 / 关于页 / 许可页需有「本软件使用了 HarmonyOS Sans 字体」的显著声明。
3. **鸿蒙黑体不得改动**：⇒ **不得子集化、不得格式转换、不得改名**。若为瘦身做子集化，**该字体必须从清单移除**（这是它与 OFL 字体最关键的区别）。
4. **OFL 字体若做子集化 / woff2 转换 / 改名**：对**已声明 RFN** 的字体，修改后必须**去掉**其 RFN（上表 RFN 列非「未声明」者）。对「未声明」者可保留原名。
   - ⚠️ 霞鹜文楷的 `[ADDITIONAL PERMISSION]` 只对「未改源码的重新编译」和「**仅用于网页字体分发**的子集化」放宽 RFN；**桌面安装包子集化不在放宽范围内** ⇒ 若子集化请改名。
5. **许可变更监控**：`license-verification.json` 记录了每份许可原文的 SHA-256。**每次发版前重跑一次**，哈希变化即需重新人工审阅（厂商随时可能改条款）。
6. **`revocable` 风险登记**：鸿蒙黑体的许可可撤销。建议在法务台账登记该依赖。

## 五、未解决的问题（需要你的决定）

### 5.1 用户原话里的「雾」无法对应到任何字体

原话列举为「常见写作字体（如**霞、雾、文、楷**、鸿蒙黑体、小米、阿里巴巴普惠体等）」。
其中「霞」= 霞鹜文楷、「文」= 文津宋体/朱雀仿宋、「楷」= 寒蝉正楷体，均已核实；
但**「雾」在全仓库、全部会话缓存、以及联网检索中都没有对应到任何字体**（唯一命中都是小说正文里的「雾海」等词）。

**请你确认「雾」指哪款字体**，我再去核它的许可。若是笔误或与「霞」重复，请直接告知忽略。

### 5.2 三款用户点名要的字体**不能**捆绑

「小米」（MiSans）与「阿里巴巴普惠体」已确认不可捆绑（原因见 §二）。这两款是**用户明确点名**要的，
所以这里不是「技术上做不到」，而是**授权上不允许**——需要你知悉并决定替代方案：

- 小米字体 → 可用 **鸿蒙黑体** 或 **思源黑体 / Noto Sans CJK** 替代（同为现代无衬线黑体）
- 阿里巴巴普惠体 → 可用 **思源黑体** 或 **更纱黑体** 替代

若你希望仍要捆绑这两款，唯一合规路径是**向小米 / 阿里巴巴申请书面授权**，我不建议在无授权情况下捆绑。

## 六、证据文件索引

| 文件 | 内容 |
|---|---|
| `verify-bundle-licenses.mjs` | 核验器本体（含 14 项自检：8 段真实许可片段 + 6 项内容闸门） |
| `license-verification.json` | 25 款候选的完整结果：判定、版权行、RFN、许可原文 SHA-256、逐字判定依据 |
| `.font-research/evidence/HarmonyOSSans_SC_LICENSE_utf8.txt` | 鸿蒙黑体官方字体许可（一手，3357 字节） |
| `.font-research/evidence/MiSans_license.txt` | MiSans 许可（一手） |
| `.font-research/evidence/yuqueapi_1733765915.txt` | 阿里巴巴普惠体法律声明（一手 API 响应，4419 字节） |
| `.font-research/evidence/superhan_license.txt` | SuperHan 许可（一手，4396 字节，OFL-1.1） |
| `../font-license-due-diligence.md` | 前期尽调报告（过程记录 + 证据索引；两处结论已由本报告修正） |

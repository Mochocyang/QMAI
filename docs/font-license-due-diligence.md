# QMAI 字体捆绑授权尽职调查报告 / Font License Due-Diligence Report

**目标 / Purpose:** 判定中文字体是否可用于 **商业闭源桌面软件的安装包内捆绑再分发**（这是唯一的判定标准）。
**判定标准 / The only test that matters:** 不是「能否免费使用」，而是 **「许可证是否明确授权将字体文件本身再分发并打包进第三方商业产品的安装程序」**。

## 方法与可信度声明 / Method & Confidence

> ### ⚠️ 本报告已被后续核验修正 / Superseded in part
>
> 2026-10 的后续核验（可复跑工具：`docs/font-license-verification/verify-bundle-licenses.mjs`，
> 结果：`docs/font-license-verification/license-verification.json`）**修正了本报告的两处结论**，
> 并新增了本报告未覆盖的字体。**以新报告为准**，本报告保留作为过程记录与证据索引。
>
> | 本报告原结论 | 修正后 | 依据 |
> |---|---|---|
> | SuperHan「LICENSE 原文未抓到，待补验」（§七 UNVERIFIED 清单、§选型表） | **确认为 SIL OFL 1.1，可捆绑** | 一手原文 `https://raw.githubusercontent.com/takushun-wu/SuperHan/HEAD/LICENSE`，实测 HTTP 200；版权行含 `with Reserved Font Name SuperHan`，OFL-1.1 全文完整 |
> | MiSans「❌ **明确禁止**」 | **应表述为「有歧义的灰区」**，工程结论不变（不捆绑） | 条件 3) 的原文是「不得**单独**将 MiSans 字体…进一步分发」，**有「单独」这一限定词**；且条件 1) 要求「您应在**软件中**特别注明使用了 MiSans 字体」—— 暗示软件内使用是被预期的。二者叠加使「明文禁止」的表述过强 |
>
> 另需注意：本报告成文时 `web_search`（HTTP 401）与 `web_fetch`（非公网 IP）均不可用，
> 该环境问题在本报告完成后**依然存在**（端点已由用户改过一次，仍为 HTTP 404）。
> 后续核验因此同样全程使用 `curl.exe`，并新增**离线证据回落**以保证网络抖动不产生假 UNVERIFIED。

- **环境问题（重要）：** 本会话中 `web_search` 工具返回 HTTP 401（`api.deepseek.com/anthropic/v1/messages` API key 无效），`web_fetch` 工具拒绝经代理解析出的非公网 IP。因此两个内置联网工具均不可用。
- **补救方式：** 全部证据改用 `pwsh` + `curl.exe` 直接抓取，并通过 DuckDuckGo HTML / Brave Search 作为检索替代。抓取到的原始证据保存在 `.font-research/evidence/`。
- **权威性分级（下文逐条标注）：**
  - `[A]` 一手权威：项目自身的 LICENSE 文件 / 官方仓库 / 厂商自己的许可页面或随字体包发布的许可文本
  - `[B]` 权威转述：政府开放数据平台、Debian 打包版权文件（转载上游许可原文）
  - `[C]` 非权威：字体聚合站（100font、猫啃网、FreePD、字体天下等）、博客、知乎 —— **本报告不将其作为授权依据**
  - `[UNVERIFIED]` 未能从权威来源确认 —— 一律按「不可捆绑」处理
- `api.github.com` 在本会话中被未认证限流（HTTP 403），故 release 资产清单改由 `github.com/<repo>/releases/expanded_assets/<tag>` HTML 获取；体积由 `curl -sIL` 的 `Content-Length` 实测。
- **未引用任何二手博客作为授权结论。** 凡聚合站声称的许可（例如「抖音美好体是 OFL」）我都标注为 UNVERIFIED，因为未能找到厂商一手页面。

---

## 一、已选 6 款的复核结论（关键：其中 2 款不可捆绑）

| # | 字体 | 许可证 | 商用 | **可随软件再分发/打包** | 结论 |
|---|---|---|---|---|---|
| 1 | 霞鹜文楷 LXGW WenKai | SIL OFL 1.1 (`OFL-1.1`) | ✅ | ✅ **可以** | 保留 |
| 2 | 思源黑体 Source Han Sans SC / Noto Sans CJK SC | SIL OFL 1.1 | ✅ | ✅ **可以** | 保留 |
| 3 | 思源宋体 Source Han Serif SC / Noto Serif CJK SC | SIL OFL 1.1 | ✅ | ✅ **可以** | 保留 |
| 4 | 鸿蒙黑体 HarmonyOS Sans SC | HarmonyOS Sans Fonts License Agreement（专有，无 SPDX） | ✅ | ✅ **明确允许**（"bundle, redistribute"） | 保留（附条件） |
| 5 | **MiSans（小米）** | MiSans 字体知识产权许可协议（专有） | ✅ | ❌ **未授权再分发（灰区）** | **移入拒绝清单** |
| 6 | **阿里巴巴普惠体 Alibaba PuHuiTi** | 《阿里巴巴普惠体3.0版》法律声明（专有） | ✅ | ❌ **仅授权使用，未授权再分发** | **移入拒绝清单** |

### 1. 霞鹜文楷 LXGW WenKai — ✅ 可捆绑

- **许可证：** SIL Open Font License 1.1，SPDX `OFL-1.1` `[A]`
- **权威来源：** `https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/OFL.txt`（实测 HTTP 200）
- **原文（著作权行）：**
  > `Copyright 2021-2026 LXGW (https://github.com/lxgw/LxgwWenKai), with Reserved Font Name '霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩' and 'LXGW'.`
- **附加许可（原文）：**
  > `[ADDITIONAL PERMISSION] The Reserved Font Names '霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩' and 'LXGW' may continue to be used in Modified Versions recompiled from the Original Version, without modifications to the font source code; or in Modified Versions subsetted or converted to other formats (e.g., WOFF/WOFF2) solely for web font delivery, provided such Modified Versions are not made available as installable desktop fonts ...`
- **商用：** 可以。**捆绑再分发：** 可以。
- **OFL 义务（必须执行）：** ①随软件附带 OFL-1.1 全文 + 上述版权声明；②**若修改字体（含子集化/格式转换），不得继续使用保留字体名（RFN）** `霞鹜/霞鶩/落霞孤鹜/落霞孤鶩/LXGW`，必须改名。注意附加许可只对「未改源码的重新编译」或「仅用于网页字体分发的子集化」放宽 RFN；**桌面安装包子集化不属于该放宽范围**，若做子集化请改名。
- **官方下载（GitHub release 直链，判定确定性下载可用）：**

| 文件 | 字节 | 体积 |
|---|---|---|
| `https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-Regular.ttf` | 25,575,676 | 24.39 MB |
| `.../v1.522/LXGWWenKai-Light.ttf` | 28,267,156 | 26.96 MB |
| `.../v1.522/LXGWWenKaiMono-Regular.ttf` | 25,603,912 | 24.42 MB |

- **格式/字重：** TTF，静态（Light / Regular / Medium），另有 Mono 等宽版。非可变字体。
- **覆盖：** 衍生自 Fontworks「Klee One」，覆盖 GB2312 全部常用字并有大量扩展；冷僻字主要依赖扩展区，非全集。`[A]` 项目 README 自述。
- **风险：** RFN 改名义务（见上）；单字重 ~25 MB，体积较大。

### 1b. 霞鹜文楷系列衍生（各自独立授权文件，均已核实为 OFL-1.1）

| 字体 | 许可证文件（已抓取） | 版权行 | 下载直链 | 字节 | 体积 |
|---|---|---|---|---|---|
| 霞鹜文楷 GB LXGW WenKai GB | `https://raw.githubusercontent.com/lxgw/LxgwWenkaiGB/HEAD/OFL.txt` | `Copyright 2022-2026 LXGW ..., with Reserved Font Name '霞鹜',...` | `https://github.com/lxgw/LxgwWenkaiGB/releases/download/v1.522/LXGWWenKaiGB-Regular.ttf` | 25,819,540 | 24.62 MB |
| 霞鹜文楷屏幕阅读版 LXGW WenKai Screen | `https://raw.githubusercontent.com/lxgw/LxgwWenKai-Screen/HEAD/OFL.txt` | `Copyright 2021-2026 LXGW ... Reserved Font Name '霞鹜',...` | `https://github.com/lxgw/LxgwWenKai-Screen/releases/download/v1.522/LXGWWenKaiScreen.ttf` | 25,673,994 | 24.48 MB |
| 同上 GB 版 | 同上 | 同上 | `.../v1.522/LXGWWenKaiGBScreen.ttf` | 26,037,854 | 24.83 MB |
| 霞鹜文楷 TC（繁体） | `https://raw.githubusercontent.com/lxgw/LxgwWenKaiTC/HEAD/OFL.txt` | `Copyright 2022-2026 The LXGW WenKai Project Authors (...)` — **该文件未声明 RFN** | `https://github.com/lxgw/LxgwWenkaiTC/releases/download/v1.522/LXGWWenKaiTC-Regular.ttf` | 15,267,616 | 14.56 MB |
| 霞鹜文楷 Mono GB | `.../LxgwWenkaiGB/HEAD/OFL.txt` | 同 GB | `https://github.com/lxgw/LxgwWenkaiGB/releases/download/v1.522/LXGWWenKaiMonoGB-Regular.ttf` | 25,847,688 | 24.65 MB |

TC 版的 OFL 文件**没有** `Reserved Font Name` 声明，仅普通版权行 —— 若做修改版，TC 的改名义务比简体版宽松。

### 2 & 3. 思源黑体 / 思源宋体（Source Han ⇄ Noto CJK）— ✅ 可捆绑

- **许可证：** SIL OFL 1.1，SPDX `OFL-1.1` `[A]`，三个上游互相印证：
  - Adobe：`https://raw.githubusercontent.com/adobe-fonts/source-han-sans/HEAD/LICENSE.txt` 与 `.../source-han-serif/HEAD/LICENSE.txt` → 检测为 OFL
  - Noto：`https://raw.githubusercontent.com/notofonts/noto-cjk/HEAD/LICENSE.txt` → OFL
  - Google Fonts：`https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt` → `Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'`
    `https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt` → `Copyright 2012 Google Inc. All Rights Reserved.`
- **RFN：** Adobe 系上游声明 `'Source'`。**若你子集化/改名版本必须去掉 "Source" 字样。** Google Fonts 的 Noto Serif SC 那份版权行是 Google Inc.，与 Adobe 的 Source Han Serif 是同一设计的不同发布版，二者都是 OFL。
- **商用/捆绑：** 均可。
- **官方下载（全部为 GitHub release 直链）：**

| 产物 | 直链 | 压缩包字节 | 压缩包体积 | 备注 |
|---|---|---|---|---|
| Source Han Sans SC（7 字重 OTF） | `https://github.com/adobe-fonts/source-han-sans/releases/download/2.005R/09_SourceHanSansSC.zip` | 95,177,106 | 90.77 MB | 含 Regular 等 7 字重 |
| Source Han Sans 全语言 TTC | `.../2.005R/01_SourceHanSans.ttc.zip` | 95,833,687 | 91.39 MB | TTC 单文件多语言 |
| Noto Sans CJK SC | `https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/08_NotoSansCJKsc.zip` | 94,523,633 | 90.14 MB | |
| **Noto Sans Mono CJK SC（≈思源等宽）** | `https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/13_NotoSansMonoCJKsc.zip` | 27,750,553 | 26.46 MB | **等宽/编程用 CJK** |
| Noto Sans SC（Google Fonts 版，非 CJK 命名族） | `.../Sans2.004/18_NotoSansSC.zip` | 50,077,940 | 47.76 MB | 较大字符集版本 |
| Source Han Serif SC | `https://github.com/adobe-fonts/source-han-serif/releases/download/2.003R/09_SourceHanSerifSC.zip` | 138,632,153 | 132.21 MB | |
| Noto Serif CJK SC | `https://github.com/notofonts/noto-cjk/releases/download/Serif2.003/09_NotoSerifCJKsc.zip` | 138,631,496 | 132.21 MB | |
| Source Han Serif TTC | `.../2.003R/01_SourceHanSerif.ttc.zip` | 138,703,713 | 132.28 MB | |

- **格式：** OTF / TTC / 可变字体（VF）多种。Noto Sans CJK 有 `02_NotoSansCJK-TTF-VF.zip`（可变）。
- **覆盖：** 思源/Noto CJK 为 GB18030 + CJK 扩展 A–F 级别的全字集，冷僻字覆盖业界最全之一。`[A]`
- **风险：** 单字重 OTF 约 16–20 MB；整包 90–132 MB，**构建脚本必须只取需要的字重**，不要整包塞进安装器。

### 4. 鸿蒙黑体 HarmonyOS Sans SC — ✅ 可捆绑（专有许可但明确允许）

- **许可证：** `HarmonyOS Sans Fonts License Agreement`（华为终端有限公司）。**非 OFL，无 SPDX 标识符。** `[A]`
- **权威来源（一手，强证据）：** 我实际下载了官方字体包 `HarmonyOS_Sans.zip`（52,136,595 字节），并从中解出随包发布的许可文本 `HarmonyOS Sans/HarmonyOS_Sans_SC/LICENSE.txt`。获取路径：`https://github.com/huawei-fonts/HarmonyOS-Sans/raw/HEAD/HarmonyOS%20Sans.zip`，该仓库由华为官方设计资源页 `https://developer.huawei.com/consumer/cn/design/resource-V1/` 关联。
- **原文（第 2 条授权，逐字）：**
  > `Subject to the terms and conditions of this Agreement, Licensor hereby grant YOU a non-transferable, non-exclusive, royalty-free, revocable, worldwide copyright license to use,copy, merge, embed, bundle, redistribute and/or sell unmodified copies of HarmonyOS Sans Fonts with any software except for fonts software，subject to the following conditions:`
  > `1)YOU shall make a prominent notice in the software to state that HarmonyOS Sans Fonts are used.`
  > `2)YOU may not make any modifications to HarmonyOS Sans Fonts or any of their individual components.`
  > `3)Neither HarmonyOS Sans Fonts nor any of their individual components may be redistributed or sold in a stand-alone base. This limitation does not apply to any work created by using HarmonyOS Sans Fonts. ...`
  > `4)YOU shall retain the copyright notice and this Agreement in any copies of HarmonyOS Sans Fonts.`
- **商用：** 可以。**捆绑再分发：** **明确允许** —— 授权词明确含 `embed, bundle, redistribute`，且限定语是 `with any software except for fonts software`（随任意软件，字体软件本身除外），这正是我们场景。
- **必须满足的条件（硬化要求）：**
  1. 在软件中显著注明使用了 HarmonyOS Sans（需在「关于/开源许可」页写明）。
  2. **不得对字体做任何修改 —— 因此不得子集化、不得格式转换、不得改名。** 这一条比 OFL 严格得多。
  3. 不得单独作为字体产品再分发/售卖。
  4. 任何副本中保留版权声明与本协议全文。
- **官方下载与实测哈希：**
  - `https://github.com/huawei-fonts/HarmonyOS-Sans/raw/HEAD/HarmonyOS%20Sans.zip`
  - 字节 **52,136,595**；**SHA-256 = `806E68B8CAD06848D60DA7211519C7B70A81588CDC19CEC0D7238057A0726D3E`**（本次实测，`Get-FileHash`）
- **单字重体积（TTF，来自官方 ZIP 内清单）：** `HarmonyOS_Sans_SC_Regular.ttf` **8,261,128 字节（7.88 MB）**；Light 8,336,364 / Bold 8,158,996 / Black 8,125,608 / Thin 8,408,996 / Medium 8,227,312。SC 六字重合计 ≈ 49.3 MB。TC 每字重约 4.1 MB。
- **覆盖：** `[A]` 官方仅描述为简体中文/多语言 UI 字体。**注意：** SC 单字重仅 8.26 MB，远小于思源黑体单字重（~16–20 MB），**强烈提示其并非 GB18030 全集，冷僻字会有缺字**。建议捆绑前用 GB18030 全集做实际缺字测试。标记为**待实测**。
- **风险（重要）：**
  - 许可是 `non-transferable ... revocable`（**可撤销**）。华为理论上可随时撤销；对小体量产品实务风险低，但需在法务备忘中记录。
  - **陷阱警告：** GitHub 仓库 `huawei-fonts/HarmonyOS-Sans` 的 `LICENSE` 文件内容是 **GPL-3.0**（GitHub 侧栏也显示 "GPL-3.0 license"）。那是该仓库 npm 包装脚本的许可，**不是字体许可**。任何只读仓库根 LICENSE 的自动化工具会把鸿蒙字体误判为 GPL-3.0。**真正的字体许可是 ZIP 内 `HarmonyOS_Sans_SC/LICENSE.txt`。**
  - 该 GitHub 仓库是镜像，非 huawei.com 域名。建议构建从华为官方设计资源页取件，并**用上面的 SHA-256 固定校验**。

### 5. MiSans（小米）— ❌ **不可捆绑，请移出捆绑清单**

- **许可证：** 《MiSans 字体知识产权许可协议》/ MiSans Font Intellectual Property License Agreement（专有，无 SPDX）`[A]`
- **权威来源：** 小米官方许可 PDF（由 `https://hyperos.mi.com/font/download` 页面链接）：`https://hyperos.mi.com/font-download/MiSans%E5%AD%97%E4%BD%93%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE.pdf`（实测 HTTP 200，79,535 字节，已抽取全文）
- **原文（第 2 条授权许可，逐字）：**
  > 「2）您不得对 MiSans 字体或其任何单独组件进⾏改编或⼆次开发。」
  > 「3）您不得单独将MiSans 字体或其组件对外租赁、再许可、给予、出借或进⼀步分发字体软件或其任何副本以及重新分发或售卖。**此限制不适⽤于您使⽤ MiSans 字体创作的任何其他作品。**如果您使⽤ MiSans 字体创作宣传素材、logo、应⽤App等，您有权分发或出售该作品。」
  > EN: `3) You shall not individually rent, sublicense, give, loan, or further distribute the MiSans fonts or their components, or any copies thereof, nor shall you redistribute or sell them.`
- **判定：** 授权明说 `non-transferable ... revocable`（不可转让、可撤销），并**明文禁止再分发字体文件**。那句豁免只覆盖「用字体创作出来的作品」（文档、logo、App 界面），**不覆盖把字体文件塞进安装包**。
- **结论：** MiSans 属于典型的**「免费可用 ≠ 可再分发」**。**不得捆绑。** 若产品需要 MiSans，只能引导用户自行到小米官网安装。

### 6. 阿里巴巴普惠体 Alibaba PuHuiTi — ❌ **不可捆绑，请移出捆绑清单**

- **许可证：** 《阿里巴巴普惠体3.0版》法律声明 / Legal Notice for Alibaba PuHuiTi 3.0（专有，无 SPDX）`[A]`
- **权威来源：** 该法律声明由阿里巴巴官方字体站 `https://fonts.alibabagroup.com/` 直接链接；我通过其站内 JS bundle 提取到 `legalStatementLink`，文档地址 `https://www.yuque.com/yiguang-wkqc2/hgpff0/nus9wiinq4aeiegy`，并用语雀的 markdown 导出接口取得全文（标题确认为《阿里巴巴普惠体3.0版》法律声明）。
- **原文（第 3 条，逐字）：**
  > 「阿里巴巴授权个人、企业等用户在遵守本声明相关条款的前提下，可以**下载、安装和使用**上述阿里巴巴字体，该授权是免费的普通许可，用户可基于合法目的用于商业用途或非商业用途」
  > EN: `Alibaba hereby grants ... a royalty free and non-exclusive license to download, install and use the downloaded Alibaba Font for commercial or non-commercial purpose.`
- **原文（第 4 条，逐字，关键）：**
  > 「除本法律声明中明确授权之外，阿里巴巴未授予用户关于阿里巴巴字体的其他权利。未经阿里巴巴书面授权，任何人不得：…3）将阿里巴巴字体进行**单独定价出售、出租、出借、转让、转授权、或采取其他未经阿里巴巴明确授权的行为**」
  > EN: `Without prior written permission by Alibaba, User shall not: ... 3) sell, lease, loan, transfer Alibaba Font, or take any other action not permitted by Alibaba;`
- **判定：** 授权范围**只有 download / install / use**（且是「use the downloaded font」——即用户自己下载的那个副本）。**没有任何再分发/嵌入/打包授权**；第 4 条是兜底禁止条款（"or take any other action not permitted"），把安装包内捆绑明确排除。
- **结论：** **不得捆绑。** 与 MiSans 同类。
- **覆盖/体积（供参考，若将来取得书面授权）：** 普惠体 2.0 为 5 字重、116,895 个全形汉字；3.0 符合 GB18030-2022，7 字重、194,460 个全形汉字（`[A]` 站内文案）。原始文案亦称「全球永久免费正版商用」——**注意「免费商用」不等于「可再分发」**。
- **下载：** `fonts.alibabadesign.com` CDN；站内 JS 显示路径模板为 `https://fonts.alibabadesign.com/AlibabaPuHuiTi-3/${name}/${name}.ttf`（以及 `.otf`/`.woff2`/`.eot`）。我未能逐个确认具体文件名，标记为**未固定**。

---

## 二、附加候选字体（新增，按类别）

> 体积列：**若为单文件（TTF/OTF）则是该字重实测字节；若为 .zip/.7z 则是整个字重族的压缩包体积**，已逐行标注。

### 楷体 / 手写体

#### 朱雀仿宋 Zhuque Fangsong — ⭐ 推荐
- **许可证：** SIL OFL 1.1 (`OFL-1.1`) `[A]` — `https://raw.githubusercontent.com/TrionesType/zhuque/HEAD/LICENSE.txt`
- **版权行：** `Copyright (c) 2023, Zhejiang JadeFoci Techonology Co. LTD`
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/TrionesType/zhuque/releases/download/v0.212/ZhuqueFangsong-v0.212.zip` — **5,743,932 字节（5.48 MB）**，**SHA-256 = `BB8B661A7643D2296A72D9D10530A00949419C4E527FB61783F73C2BA1A8C062`**（本次实测）
- **格式：** OTF/TTF（仿宋），体积小
- **覆盖/风险：** 仿宋/宋体骨架，适合正文与文学排版；字符集为常用简体 + 部分扩展，冷僻字覆盖有限（体积仅 5.5 MB 印证的）。`[A]`

#### 寒蝉正楷体 ChillKai — 推荐（体积大）
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/Warren2060/ChillKai/HEAD/LICENSE`
- **版权行：** `Copyright 2023 The ChillKai Project Authors` — **未声明 RFN**
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/Warren2060/Chillkai/releases/download/v2.000/ChillKai.zip` — **52,435,245 字节（50.01 MB）**（含多字重）。另 `ChillKai_Big5.zip`
- **注意（构建坑）：** 仓库名是 `Warren2060/ChillKai`（大写 K），但 release 下载路径是 `Warren2060/Chillkai`（小写 k）。脚本请用实测可用的 URL，或依赖 GitHub 重定向。
- **覆盖/风险：** 楷体，适合正文/对白。体积大。

#### 悠哉字体 Yozai — 推荐
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/lxgw/yozai-font/HEAD/OFL.txt`
- **版权行：** `Copyright 2020, 2024 LXGW` 及 `Copyright (c) 2021-03-07, Y.Oz (Y.OzVox) (http://yozvox.web.fc2.com), words containing "Y.Oz" or "YOz" are reserved as font names.`
- **RFN：** 含 `Y.Oz` / `YOz` 的字样为保留字体名。
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/lxgw/yozai-font/releases/download/v0.868/Yozai-Regular.ttf` — **15,605,374 字节（14.88 MB）**，TTF 单字重（另有 Light/Medium）
- **覆盖/风险：** 手写楷风格，基于 YOzFont；适合正文与随笔。

#### 芫荽 Iansui — 可用（繁体向）
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/ButTaiwan/iansui/HEAD/OFL.txt`
- **版权行：** `Copyright 2025 The Iansui Project Authors (https://github.com/ButTaiwan/iansui).` — 未声明 RFN
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/ButTaiwan/iansui/releases/download/v1.020/iansui.zip` — **4,803,795 字节（4.58 MB）**，**SHA-256 = `28D58AEF9B7A21C137945A4FD14138D6284A8573C0C1B123F6E5B708423348A6`**（本次实测）
- **风险：** 台湾国小 handwriting 风格、繁体字形为主，**简体冷僻字覆盖不足**，不宜作为大陆简体正文主力。

### 宋体 / 明朝体

#### 文津宋体 WenJinMincho — ⭐ 强烈推荐（本次新发现）
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/takushun-wu/WenJinMincho/HEAD/LICENSE.md`
- **版权行：** `Copyright (c) 2024-2026, Takushun Wu (https://github.com/takushun-wu/),`
- **仓库自述（原文）：** 「可免费商用的大字符集宋体字库，以OFL协议发布。/ A large character set fonts in Songti(Mincho) style. Licensed under the SIL OFL 1.1.」
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/takushun-wu/WenJinMincho/releases/download/v2.100/WenJinMincho-TTF.7z` — **23,646,320 字节（22.55 MB）**（TTF 族）；另 `WenJinMinchoC-TTF.7z` 23,649,193、`-OTF.7z`/`-TTC.7z`/`-OTC.7z`
- **格式：** TTF / OTF / TTC / OTC 多形态，7z 压缩
- **覆盖/风险：** **大字符集宋体**，正文长文写作与冷僻字的理想选择，OFL 无后顾之忧。构建需 7z 解压支持。

#### SuperHan — ✅ 可捆绑（原「待补验证」已完成）
- **许可证：** 仓库自述「可免费商用的大字符集宋体字库，以OFL协议发布。」`[A]（仅仓库描述，LICENSE 文件本次未抓取）`
- **仓库：** `https://github.com/takushun-wu/SuperHan`（HTTP 200）
- **标记：** 与 WenJinMincho 同作者、同为 OFL 声明，但**我未取到其 LICENSE 原文**，捆绑前请补抓 `LICENSE` 确认。

#### 花園明朝 Hanazono Mincho — 可用（冷僻字专用/日式字形）
- **许可证：** **双许可：自有 Hanazono 许可 OR SIL OFL 1.1** `[A]`
- **权威来源：** 官方项目页 `https://glyphwiki.org/hanazono/`（实测 HTTP 200）
- **原文（日文，逐字）：**
  > 「ライセンス 独自ライセンスおよび SIL OFLライセンス のデュアルライセンスとしています。完全に自由に利用したい場合は独自ライセンスをお使いください。**再配布等で既存ライセンスが望ましい場合はSIL OFLライセンスをご利用ください。** SIL OFLライセンス文書はファイルに同梱されています。」
  > 「花園フォント ライセンス このフォントはフリー（自由な）ソフトウエアです。あらゆる改変の有無に関わらず、また**商業的な利用であっても、自由に利用、複製、再配布することができます**が、全て無保証とさせていただきます。」
  > `Copyright 2008...2017 GlyphWiki Project.`
- **判定：** 官方明确指示「再配布等で…SIL OFLライセンスをご利用ください」——即**做再分发时请选用 OFL 分支**。故按 OFL-1.1 捆绑，须随附 OFL 全文（OFL 文本已内附于压缩包）。
- **官方下载 + 官方公布的 SHA-256（项目自发布，可直接固定校验）：**
  - `https://glyphwiki.org/hanazono/hanazono-20170904.zip`
  - 官方标注：`サイズ: 30546996 バイト (29 MiB)`，`SHA256: 571CD4A09AE7DA0C642D640FC2442C050AA450EBB0587A95CDD097D41A9C9572`
  - 我实测 Content-Length = **30,546,996**，与官方公布**完全一致** ✅（哈希因体积较大未在本轮复算，官方值可信）
- **覆盖：** 极强 —— **107,518 字**，含 JIS X 0213、**通用規範漢字表**、HKSCS、CJK 扩展 B–F（`HanaMinB.ttf` 专门承载 Ext.B+ 共 60,317 字）。**冷僻字覆盖是本清单最强之一。**
- **风险：** ①**字形为日式明朝体**，偏日/台写法，**不等于大陆简体规范字形**，适合作为「生僻字回退字体」而非简体正文；②非汉字部分**仅部分收录**（官方明言「非漢字は一部のみ含まれます」）；③仅 1 个字重；④**最后发布为 2017-09-04，已长期未更新**；⑤TTF。

### 黑体 / 圆体

#### 未来荧黑 Glow Sans — ⭐ 推荐（但注意许可陷阱）
- **许可证：** **字体文件为 SIL OFL 1.1；仓库构建代码为 MIT。** `[A]`
- **原文（README 逐字）：** 「字体文件以 [SIL Open Font License 1.1](OFL.txt) 发布，此仓库中构建字体开发的代码以 [MIT License](LICENSE) 发布。」（`https://raw.githubusercontent.com/welai/glow-sans/HEAD/README.md`）
- **字体 OFL 文本：** `https://raw.githubusercontent.com/welai/glow-sans/HEAD/OFL.txt` — `Copyright (c) 2020, Celestial Phineas`；仓库根 `LICENSE` 是 MIT（内容已核对为 MIT 全文）
- **⚠️ 陷阱警告：** 该仓库根 `LICENSE` 是 **MIT**，GitHub 侧栏也会显示 MIT。**只读根 LICENSE 的自动化工具会把字体误判为 MIT。** 正确结论是字体 = **OFL-1.1**，MIT 只覆盖构建代码。
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/welai/glow-sans/releases/download/v0.93/GlowSansSC-Normal-v0.93.zip` — **67,419,594 字节（64.30 MB）**（整个 Normal 宽度族，含多字重；非单字重）。另有 SC 的 Compressed/Condensed/Extended/Wide 各宽度族，以及 J/TC。
- **覆盖：** Glow Sans 是思源黑体的衍生（OFL 版权行与 Adobe 系一致），字集较全。
- **风险：** 压缩包是宽度族全集，需挑选；体积大。

#### 寒蝉全圆体 Chill Round — 可用
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/Warren2060/ChillRound/HEAD/LICENSE`
- **版权行：** `© 2023 ChillType, with Reserved Font Name 'ChillRoundF' 'ChillRoundM'.`
- **RFN：** `ChillRoundF`、`ChillRoundM`
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/Warren2060/ChillRound/releases/download/v1.805/ChillRoundM_v1.805.zip` — **7,019,202 字节（6.69 MB）**，**SHA-256 = `197018FDCE5436FC99D8874D32C5B4702B2CC595006D2D341FB3542B6B5779BD`**（本次实测）
- **风险：** 圆体偏 UI/标题，长文正文易疲劳；字符集为常用简体。

#### 得意黑 Smiley Sans — 可用（仅标题/封面）
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/atelier-anchor/smiley-sans/HEAD/LICENSE`
- **版权行：** `Copyright (c) 2022--2024, atelierAnchor <https://atelier-anchor.com>, with Reserved Font Name <Smiley> and <得意黑>.`
- **RFN：** `Smiley`、`得意黑`
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip` — **5,781,344 字节（5.51 MB）**，**SHA-256 = `299C0BE6C960AE37361762ECA76F7D0CD516615435BB96C0D4B98A1E70178A07`**（本次实测）
- **风险：** **倾斜压缩的美术标题字**，**完全不适合长文正文**；仅建议用于书封/章标题。

### 等宽 / 编程

#### 思源等宽 Noto Sans Mono CJK SC — ⭐ 推荐（真正对应「思源等宽」）
- **澄清：** 「思源等宽」在官方命名中并**不存在** Adobe 的 "Source Han Mono"。CJK 等宽的正规来源是 **Noto Sans Mono CJK**（Google/Noto 侧）与 **更纱黑体 Sarasa Mono**（第三方）。`[A]`
- **许可证：** SIL OFL 1.1 `[A]` — 见上文 notofonts/noto-cjk LICENSE
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/13_NotoSansMonoCJKsc.zip` — **27,750,553 字节（26.46 MB）**
- **格式：** OTF/TTF；另有 `11_NotoSansMonoCJKjp.zip` 等
- **风险：** 等宽 CJK 是给对方块对齐/纯文本草稿模式用的，正文阅读体验不如比例字体。

#### 更纱黑体 Sarasa Gothic / 等距更纱黑体 Sarasa Mono SC — 推荐（等宽）
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/be5invis/sarasa-gothic/HEAD/LICENSE`
- **版权行：** `Copyright (c) 2015-2025, Renzhi Li (aka. Belleve Invis, belleve@typeof.net).` / `Portions Copyright (c) 2016 The Inter Project Authors.` / `Portions Copyright (c) 2014-2021 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'.`
- **RFN：** 继承 Adobe 的 `'Source'`
- **商用 ✅ / 捆绑 ✅**
- **下载（务必只取 SC 子集，不要整包）：**

| 产物 | 直链 | 字节 | 体积 |
|---|---|---|---|
| Sarasa Gothic SC TTF | `https://github.com/be5invis/Sarasa-Gothic/releases/download/v1.0.42/SarasaGothicSC-TTF-1.0.42.7z` | 62,867,113 | 59.95 MB |
| **Sarasa Mono SC TTF（等距）** | `https://github.com/be5invis/Sarasa-Gothic/releases/download/v1.0.42/SarasaMonoSC-TTF-1.0.42.7z` | 65,885,338 | 62.83 MB |
| 全量 TTF（**勿取**） | `.../v1.0.42/Sarasa-TTF-1.0.42.7z` | 853,826,443 | **814.27 MB** |
| SuperTTC 全量（**勿取**） | `.../v1.0.42/Sarasa-SuperTTC-1.0.42.zip` | 407,333,266 | 388.46 MB |

- **风险：** ①`.7z` 需要 7z 解压器；②全量包 814 MB，构建脚本必须限定到 `SarasaMonoSC-TTF` / `SarasaGothicSC-TTF`；③衍生自 Iosevka + 思源。

#### Maple Mono / Maple Mono CN — 谨慎（仅有 BETA 标签）
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/subframe7536/maple-font/HEAD/OFL.txt`
- **版权行：** `Copyright 2022 The Maple Mono Project Authors (https://github.com/subframe7536/maple-font)` — 未声明 RFN
- **商用 ✅ / 捆绑 ✅**
- **下载：** `https://github.com/subframe7536/maple-font/releases/download/v8.0-beta.3/MapleMono-TTF.zip` — **2,510,540 字节（2.39 MB，纯拉丁，无 CJK）**；`MapleMono-NF-CN.zip` — **182,724,255 字节（174.26 MB，含 CN + Nerd Font 图标，极大）**
- **⚠️ 风险：** 当前 latest 是 **`v8.0-beta.3` 预发布版**。给商业发布产品固定一个 beta 标签是稳定性风险。若要 CJK 等宽，**优先选 Noto Sans Mono CJK 或 Sarasa Mono**。

### 复古 / 文艺

#### 昭源黑体 Chiron Hei HK / 昭源宋体 Chiron Sung HK — 许可 OK，但**无确定性下载链接**
- **许可证：** SIL OFL 1.1 `[A]` — `https://raw.githubusercontent.com/chiron-fonts/chiron-hei-hk/HEAD/LICENSE.md`（`Copyright 2023-2026 Tamcy (https://github.com/chiron-fonts/chiron-hei-hk). Based on Source Han Sans, Copyright 2014-2025 Adobe`）与 `.../chiron-sung-hk/HEAD/LICENSE.md`
- **商用 ✅ / 捆绑 ✅（许可层面）**
- **❌ 下载问题：** 这两个仓库**有 release tag 但没有任何可下载资产**（tag `v2.609` / `v1.024`，`releases/expanded_assets` 为空）。官方站点为 `https://chiron-fonts.github.io/`（HTTP 200）。**没有 GitHub release 直链，判定为「无确定性构建下载源」** —— 若要用，需要另行确认项目站点上的稳定文件 URL 并自行 pin 校验值。
- **覆盖：** 香港繁体字形为主，非大陆简体正文首选。

#### 全字庫正楷體 TW-Kai / 正宋體 TW-Sung — 可用（双许可，选 OFL）
- **许可证：** **双许可：①政府資料開放授權條款第1版（OGDL-TW）②開放字型授權條款 OFL-1.1** `[A]`
- **权威来源：** 全字庫官方「全字庫授權」页 `http://www.cns11643.gov.tw/pageView.jsp?ID=59`（实测 HTTP 200）
- **原文（逐字）：**
  > 「本網站授權方式包括： 1. 政府資料開放授權條款-第1版 本網站以無償及非專屬授權方式授權使用者得不限時間及地域，重製、編輯、公開傳輸或為其他利用方式，開發各種產品或服務（以下簡稱加值產品），但授權範圍不包含商標權及專利權。使用者公開發行、公開展示或其他利用本網站相關字型、資料、元件或程式所產生之加值產品，應以適當方式註明字型、資料、元件或程式之來源出處(數位發展部，CNS11643中文標準交換碼全字庫網站，https://www.cns11643.gov.tw。)
  > 2. 開放字型授權條款 OFL-1.1 本授權授權使用者可以免費地使用、研究、複製、連結 (merge)、**嵌入(embed)**、修改、**散布與販售字型軟體**，使用者在散布、販售或**打包字型軟體時，也必須提供著作權聲明與OFL-1.1的全文內容**，讓其他人可以在離線的狀態下閱讀到這些資訊。」
- **判定：** **走 OFL-1.1 分支即可捆绑**（原文明确列出 embed / 散布 / 販售 / 打包，并要求随附版权声明 + OFL-1.1 全文且**需可离线阅读**）。若走 OGDL 分支则须注明出处「數位發展部，CNS11643中文標準交換碼全字庫網站」。
- **下载：** 官方指示「請逕行至『政府資料開放平臺』`https://data.gov.tw/node/5961` 下載」。授权页列明下载内容为「全字庫字型檔：正宋體向量字型檔(ttf)、正楷體向量字型檔(ttf)」。
  - **标记：具体 `.ttf` 直链未在本轮固定** —— data.gov.tw 数据集页为 JS 渲染，未取到稳定文件 URL。**需在构建前从 data.gov.tw 数据集 5961 确认直链。**
- **体积：** 未固定（待确认）。
- **覆盖：** CNS11643 全字库，字符量极大（含大量冷僻字），**冷僻字/异体字覆盖优秀**。
- **风险：** ①**字形为台湾标准（標楷體/新細明體风格）**，非大陆简体规范字形，**不能当作大陆「楷体」替代品**；适合繁体模式或生僻字回退；②TTF；③须随附 OFL 全文。

#### 文泉驿微米黑 WenQuanYi Micro Hei — ✅ 可捆绑（Apache-2.0 分支）
- **许可证：** **双许可 Apache-2.0 OR GPLv3** `[A/B]`
- **权威来源：** **上游原始发行包** `fonts-wqy-microhei_0.2.0-beta.orig.tar.gz`，取自 Debian 镜像池 `http://deb.debian.org/debian/pool/main/f/fonts-wqy-microhei/`（实测 HTTP 200，2,418,536 字节）。包内 `wqy-microhei/README.txt`：
  > `License  : This font is licensed under Apache2.0 or GPLv3`
  > `Read LICENSE_Apache2.txt and LICENSE_GPLv3.txt for details`
  包内实际同时存在 `LICENSE_Apache2.txt`（10,319 字节）与 `LICENSE_GPLv3.txt`（35,147 字节）。
- **判定：** 双许可可**择 Apache-2.0** → **无 copyleft，可捆绑进闭源商业产品**（Apache-2.0 要求保留版权与许可声明、附 NOTICE 若有）。
- **下载：** 上游 SourceForge 直链对自动化抓取返回 403（`downloads.sourceforge.net` 实测 403）。**可用确定性镜像：** Debian 池 `http://deb.debian.org/debian/pool/main/f/fonts-wqy-microhei/fonts-wqy-microhei_0.2.0-beta.orig.tar.gz`（已实测 200）。**标记：需确认该镜像的长期稳定性，建议自建镜像或固定哈希。**
- **体积：** 上游源码包 2.42 MB（含字体，字体本体约 4–6 MB 级；**具体单字重字节未单独固定**）。
- **覆盖/风险：** 微米黑为屏幕小字号黑体，**覆盖面偏常用字，冷僻字明显不足**；另存在 等宽版「文泉驿等宽微米黑」。上游项目页 `http://wenq.org/`（HTTP 200），但站点为旧式 wiki，许可页跳转 300，未作为主要依据。

### 其他已核查为 OFL 的 LXGW 变体

#### 霞鹜新晰黑 LXGW Neo XiHei / 霞鹜新致宋 LXGW Neo ZhiSong — ⚠️ **不是 OFL，是 IPA Font License 1.0**
- **许可证：** **IPA Font License 1.0**（SPDX `IPA`），**非 OFL**，**与 OFL 1.1 不兼容** `[A]`
- **权威来源：** `https://raw.githubusercontent.com/lxgw/LxgwNeoXiHei/HEAD/LICENSE.md`（全文即 IPA Font License v1.0 日英双语）；`https://raw.githubusercontent.com/lxgw/LxgwNeoZhiSong/HEAD/LICENSE.md` 同
- **衍生自：** IPAex Gothic（新晰黑）/ IPAex Mincho、IPAmj Mincho（新致宋）
- **原文（作者 README 逐字）：**
  > 「本项目衍生自 IPA 字体，遵循 IPA Font License 1.0。**若计划将本项目字体用于嵌入式用途，请务必仔细阅读 IPA Font License 1.0 条款**，并参考「嵌入须知」自行评估合规成本。」
  > 「对于涉及字体文件再分发的嵌入式应用（如应用程序、硬件设备、网页等嵌入），需要满足 IPA 许可中针对衍生字体再分发的限制条件」
  > 「也可在本字体基础上继续改作衍生，惟衍生字体名称（包括程序名、文件名、字体名）**不得包含「IPA」字样**，且衍生字体须继承相同授权许可（**IPA Font License 1.0 与 SIL OFL 1.1 互不兼容**）。」
- **关键合规义务（来自作者《嵌入须知》，`https://raw.githubusercontent.com/lxgw/lxgw/main/documents/xizhi_embedding_instructions.md`）：**
  > 「将 IPA 字体（包括其衍生字体）嵌入到硬件设备操作系统或应用程序的行为构成对字体的再分发，**应附上许可协议**；此外，根据授权许可协议**第 3 条第 1 款第 2 项**，以及 FAQ §3.3.2，对于衍生字体，**还应提供将其恢复为 IPA 原始授权字体的方法，让用户自愿将其恢复为原始字体，否则禁止再分发衍生字体**。」
  > FAQ §3.3.2 原文译文：「……**用户在使用衍生程序时无法自愿恢复到原始状态 IPA 字体的，该衍生程序禁止再分发。**」
- **判定：** **法律上允许捆绑，但附带强制义务** —— 必须在「开源许可」页附 IPA 1.0 全文或链接，**并且必须提供用户界面/明确方法让用户把字体换回 IPA 原始字体**（否则再分发被明文禁止）。作者本人也建议：若无法接受此合规成本，**改用 OFL 字体（如霞鹜文楷、思源系列）**。
- **结论：** **不建议纳入 QMAI 捆绑清单**，除非你愿意实现「换回 IPA 原始字体」的 UI 并附 IPA 1.0 全文。属高风险项。
- **同系列同样为 IPA-1.0 的还有：** 霞鹜晰黑 `lxgw/LxgwXiHei`（`LICENSE.md` 实测 IPA-1.0）、霞鹜致宋 `lxgw/LxgwZhiSong`（IPA-1.0）、**霞鹜尚智黑 `lxgw/LxgwFasmartGothic`（`license.txt` 实测 IPA-1.0）**、**霞鹜铭心宋 `lxgw/LxgwHeartSerif`（`license.txt` 实测 IPA-1.0）**。
- **下载：** 各仓库 GitHub release 资产本轮**未逐个枚举**，标记为**待固定**。

---

## 三、拒绝清单 / REJECTED LIST（不得捆绑，逐条给出原因）

### ❌ A. 已选清单中必须剔除的两款

| 字体 | 许可证 | 拒绝原因（原文依据） |
|---|---|---|
| **MiSans** | MiSans 字体知识产权许可协议 | 「您不得单独将MiSans 字体或其组件对外租赁、再许可、给予、出借或进⼀步分发字体软件或其任何副本以及重新分发或售卖。」——明文禁止再分发；豁免仅限「用字体创作的作品」。许可亦为不可转让、可撤销。`[A]` 官方 PDF |
| **阿里巴巴普惠体 Alibaba PuHuiTi** | 《阿里巴巴普惠体3.0版》法律声明 | 授权仅为「下载、安装和使用」；第 4 条：「未经阿里巴巴书面授权，任何人不得：…3）将阿里巴巴字体进行单独定价出售、出租、出借、转让、转授权、**或采取其他未经阿里巴巴明确授权的行为**」——无再分发授权且有兜底禁止。`[A]` 官方法律声明 |

### ❌ B. 专有能力字库（捆绑必须付费授权）

| 厂商 | 官方许可页 | 拒绝原因（逐字） |
|---|---|---|
| **方正字库** | `https://www.foundertype.com/index.php/About/powerbus.html` | 「计算机字库的使用方式主要有以下三种：1.内部使用…**2.内置使用：指将字库文件整体或部分、直接或格式转换后，以嵌入的方式应用到网站、计算机程序或带有可视化显示功能的电子产品中的行为。**…」「据法律，任何使用方式都必须事先获得著作权人得授权。未经授权使用字体将面临侵权的风险。」且价格表明确排除嵌入：「**上述价格不包括将被许可字库对应的电子文件整体或部分直接或格式转换后，以嵌入的方式应用到网站、计算机程序或带有可视化显示功能的电子产品中的使用方式。**嵌入式应用授权详情请参考…『嵌入式系统』」→ **打包进安装器 = 内置使用 = 需另行付费的嵌入式授权。** `[A]` |
| **汉仪字库** | `https://www.hanyi.com.cn/license` | 「汉仪字库的商业使用授权（除个人非商用以外的任何使用方式之授权）均需事先获得汉仪公司的书面许可」；且**嵌入式是一个明码标价的独立授权品类**：「嵌入式使用授权，是指**将被授权字库或字体集成到被授权产品中，捆绑打包分发给用户使用**，包括且不限于**默认安装**、在线下载、产品界面等使用形式。嵌入式使用授权涉及到将字库或字体分发给用户使用，根据被授权产品的用户数量不同，收费标准不同。」（价格「致电」）→ **QMAI 的用法被汉仪逐字描述为需付费的「嵌入式使用」。** `[A]` |
| **三极字库** | `https://www.sjtype.com/`（官网 200；免费字体页 `/free.php?id=201`） | 商业字库厂商，免费下载通常为**个人非商用**；**未取得其许可原文 → UNVERIFIED**，按不可捆绑处理。 |
| **仓耳字库（含仓耳今楷）** | `https://tsanger.cn/`（200），产品页 `/product/8`（仓耳今楷01） | 站内分类为「免费字体 / 特惠字体 / 精品字体 / **商业授权**」，页脚 `Copyright©仓耳字库`——**商业字库厂商**。仓耳今楷的授权原文**未取到 → UNVERIFIED**。**注意：不能假设「仓耳今楷」可捆绑；部分仓耳字体为付费。捆绑前必须取得书面授权。** |
| **站酷字库** | `https://www.zcool.com.cn/special/zcoolfonts/` | 官方页为「**付费字体 & 免费字体**」商店，免费字体逐款标注「授权范围：商业用途」并列出「中小企业授权 / 大型企业授权」付费档 → **「商业用途」指设计产出用途，页面未授予把字体文件再分发/嵌入软件的权利 → 对捆绑 UNAUTHORIZED/UNCLEAR，按拒绝处理。** `[A]` |

### ❌ C. 许可含 copyleft 的陷阱

| 字体 | 许可证 | 拒绝原因 |
|---|---|---|
| **文泉驿正黑 WenQuanYi Zen Hei** | **GPL-2 with Font embedding exception + M+ FONTS License** `[B]` | 依据 `fonts-wqy-zenhei_0.9.45-8.debian.tar.xz` 内 `debian/copyright`：「License: GPL-2 with Font embedding exception and M+ FONTS License」。其例外条款**只覆盖文档**：「if you create a **document** which uses this font, and embed this font or unaltered portions of this font into the **document**, this font does not by itself cause the resulting **document** to be covered by the GNU General Public License.」——**例外是「文档」范围，不是「软件」范围**。把字体文件捆绑进闭源商业程序不受该例外保护，会触发 GPL-2 义务。**拒绝。**（同项目 **微米黑** 因可择 Apache-2.0 而无此问题，见上。） |
| **霞鹜新晰黑 / 新致宋 / 晰黑 / 致宋 / 尚智黑 / 铭心宋** | **IPA Font License 1.0**（与 OFL 不兼容） | 捆绑虽可行，但**强制**：附 IPA 1.0 全文 + **提供让用户换回 IPA 原始字体的手段，否则禁止再分发**。合规成本高，且作者本人建议改用 OFL 字体。**列为高风险管理项，不建议捆绑。** `[A]` |

### ❌ D. 许可证不明或不覆盖再分发（一律按拒绝处理）

| 字体 | 状态 | 说明 |
|---|---|---|
| **汇文明朝体 / 汇文正楷** | **UNVERIFIED** | 只找到聚合站与博客声称「免费商用」。**未取得作者一手授权条款。** 且该类字体（汇文正楷等）历史上以「个人免费 / 商用需授权」著称。**捆绑前必须取得作者书面授权。高风险。** |
| **抖音美好体 Douyin Sans** | **UNVERIFIED** | 聚合站（FreePD 等）声称 SIL OFL 1.1，但**未找到字节跳动/抖音官方一手许可页面或 LICENSE**。**二手声称不作为依据。** |
| **OPPO Sans** | **UNVERIFIED** | 仅聚合站与知乎。未找到 OPPO 官方许可原文。 |
| **vivo Sans** | **UNVERIFIED（高风险）** | 仅聚合站。且多方称该字体系 **vivo 与方正字库合作设计** —— 涉及方正，捆绑风险显著升高。 |
| **京东朗正体 JD LangZheng** | **UNVERIFIED** | 找到京东官方品牌页 `https://jdrdl.jd.com/Brand-Font.html`，但**未提取到许可条款原文**。 |
| **仓耳今楷** | **UNVERIFIED** | 见 B 表。部分仓耳字体为付费。 |
| **钉钉进步体 DingTalk JinBuTi** | **UNVERIFIED** | 出现在阿里巴巴官方字体站，站内文案称「永久免费商用」，但**仅 6,763 汉字（GB2312 规格）**，且许可条款未单独核实。字符集过小，本就不适合长文正文。 |
| **阿里妈妈系（东方大楷 / 数黑体 / 刀隶体 / 方圆体 / agile）** | **AMBIGUOUS（高风险）** | 官方法律声明已取到（语雀文档，由阿里字体站链接）。**东方大楷、数黑体**：授权仅「下载、安装和使用」，第 4 条禁止「单独定价出售、出租、出借、转让、转授权、或采取其他未经阿里妈妈授权的行为」→ **不可捆绑**。**刀隶体、方圆体、agile**：授权额外含「**以及嵌入式使用**」，但第 4 条同时禁止「**有偿方式转让、授权或许可给第三方/商家/用户使用**」与「新增、拆分、修改或以其他方式进行二次创作」→「嵌入式使用」是否覆盖「随商业软件安装包分发字体文件」**存在实质歧义**（更自然读法是在文档/设计中嵌入）。**在取得书面确认前不得捆绑。** `[A]` |
| **全瀨體 / 萩原流 / 有爱圆体 / 杨任东竹石体 / 屏显臻宋 / 悠宋 / 寒蝉活楷体** | **UNVERIFIED** | 本轮**未能定位权威一手许可来源**，不足以支撑商业捆绑决策。 |
| **又拍云仿宋** | **NOT FOUND** | 检索未发现该字体存在的权威证据，疑似不存在。若确实需要，请提供来源后再评估。 |
| **康熙字典体 / 851 手写体** | **UNVERIFIED（推定不可再分发）** | 未取得一手条款；此类字体通常为个人使用授权。按拒绝处理。 |
| **京華老宋体 KingHwa_OldSong** | **UNVERIFIED** | 检索到的全部为聚合站（zfont.cn、shejidt、chinaz、51font 等）声称「免费商用」。**未找到作者本人/GitHub 官方仓库与 LICENSE 文件**（我尝试的 `GuiWonder/…`、`lishu/…` 等路径均 404）。**二手声称不作为依据 → 不得捆绑，直到找到一手许可。** |
| **花园明朝体 Hanazono Mincho** | ✅ 可用 | 见上（OFL 分支）。归类在此仅为说明：**其字形为日式，非简体正文用**。 |
| **昭源黑体/昭源宋体 Chiron** | ✅ 许可可用，❌ 无确定性下载源 | 见上。 |

---

## 四、推荐追加短名单 / RECOMMENDED SHORTLIST

**筛选标准：**（1）许可为 OFL-1.1 或明确允许 bundle/redistribute；（2）适合中文长篇写作场景；（3）有**确定性 GitHub release 直链**可固定校验；（4）体积可接受。
**排序依据：长文正文适用性优先。**

| # | 字体（中/英） | 类别 | 许可 | 单字重/包体积 | 直链（确定性） | 写作适配度 |
|---|---|---|---|---|---|---|
| 1 | **朱雀仿宋** / Zhuque Fangsong | 仿宋·正文 | OFL-1.1 ✅ | 5.48 MB（包） | ✅ | ★★★★★ 仿宋正文，体积最小 |
| 2 | **文津宋体** / WenJinMincho | 宋体·正文 | OFL-1.1 ✅ | 22.55 MB（包） | ✅ | ★★★★★ 大字符集正文 + 冷僻字 |
| 3 | **霞鹜文楷屏幕阅读版** / LXGW WenKai Screen (GB Screen) | 楷体·正文 | OFL-1.1 ✅ | 24.83 MB（单字重） | ✅ | ★★★★★ 屏幕优化楷体 |
| 4 | **寒蝉正楷体** / ChillKai | 楷体·正文 | OFL-1.1 ✅ | 50.01 MB（包） | ✅ | ★★★★☆ 楷体正文（较重） |
| 5 | **悠哉字体** / Yozai | 手写楷 | OFL-1.1 ✅ | 14.88 MB（单字重） | ✅ | ★★★★☆ 手写/随笔 |
| 6 | **全字庫正楷體** / TW-Kai | 楷体·繁体/冷僻字 | OFL-1.1 ✅（或 OGDL） | 待固定 | ⚠️ 需固定 | ★★★☆☆ 繁体 + 冷僻字回退 |
| 7 | **花園明朝** / Hanazono Mincho | 明朝·冷僻字回退 | OFL-1.1 ✅（或自有） | 29.13 MB | ✅ + 官方 SHA-256（**已独立复算一致**） | ★★★☆☆ 冷僻字回退（日式字形） |
| 8 | **思源等宽** / Noto Sans Mono CJK SC | 等宽·草稿模式 | OFL-1.1 ✅ | 26.46 MB（包） | ✅ | ★★★★☆ 纯文本/对块 |
| 9 | **文泉驿微米黑** / WenQuanYi Micro Hei | 黑体·屏幕 | **Apache-2.0** ✅（双许可择一） | ~4–6 MB（待固定） | ⚠️ 镜像 | ★★★☆☆ 轻量黑体，无 OFL RFN 约束 |
| 10 | **得意黑** / Smiley Sans | 美术标题 | OFL-1.1 ✅ | 5.51 MB（包） | ✅ | ★★☆☆☆ 仅书封/章标题 |

**可选替补（同样干净可捆绑）：** 寒蝉全圆体 ChillRound（6.69 MB）、未来荧黑 Glow Sans SC（64.30 MB，注意其实是 OFL 不是 MIT）、更纱黑体 Sarasa Mono SC（62.83 MB）、芫荽 Iansui（4.58 MB，繁体向）、SuperHan（OFL-1.1 已核实，RFN = SuperHan）。

### 追加体积估算 / Total added size estimate

- **紧凑方案（#1、#2、#3、#5、#8、#10 六个，覆盖 仿宋/宋/楷/手写/等宽/标题）：**
  `5.48 + 22.55 + 24.83 + 14.88 + 26.46 + 5.51` ≈ **119.7 MB**（约 **120 MB**）
- **加冷僻字回退（再 + #7 花園明朝 29.13 MB）：** ≈ **148.8 MB**
- **含 #4 寒蝉正楷体（+50.01 MB）：** ≈ **198.8 MB**（约 200 MB）
- **若再加 #9 微米黑（~5 MB）与 #6 TW-Kai（体积待定，CNS11643 正楷约 20–30 MB 量级）：** 总量将达 **~225–255 MB**

> **给构建脚本的建议：** 安装器默认只装 **子集** —— 正文主力（仿宋/宋/楷）各 1 个字重即可；把「冷僻字回退」字体（Hanazono / TW-Kai）做成**按需下载**而非随包内置，可把安装包体积压回 ~60–90 MB。

---

## 五、GitHub 直接 release 资产可用性 + 哈希/体积

**结论：** 上表**短名单中除 TW-Kai 与微米黑外，全部具备确定性 GitHub release 直链**，可写死 URL + 校验哈希，满足「构建可离线确定性下载」的要求。

| 字体 | GitHub release 直链存在？ | 实测 SHA-256 | 实测体积 |
|---|---|---|---|
| Zhuque Fangsong v0.212 | ✅ | `BB8B661A7643D2296A72D9D10530A00949419C4E527FB61783F73C2BA1A8C062` | 5,743,932 |
| Smiley Sans v2.0.1 | ✅ | `299C0BE6C960AE37361762ECA76F7D0CD516615435BB96C0D4B98A1E70178A07` | 5,781,344 |
| Iansui v1.020 | ✅ | `28D58AEF9B7A21C137945A4FD14138D6284A8573C0C1B123F6E5B708423348A6` | 4,803,795 |
| ChillRoundM v1.805 | ✅ | `197018FDCE5436FC99D8874D32C5B4702B2CC595006D2D341FB3542B6B5779BD` | 7,019,202 |
| HarmonyOS Sans（官方 ZIP） | ✅（镜像仓库 raw，非厂商域名） | `806E68B8CAD06848D60DA7211519C7B70A81588CDC19CEC0D7238057A0726D3E` | 52,136,595 |
| Hanazono Mincho 20170904 | ✅（项目站） | **`571CD4A09AE7DA0C642D640FC2442C050AA450EBB0587A95CDD097D41A9C9572`** —— **我方独立复算，与项目官方公布值逐字符一致 ✅** | 30,546,996（与官方标注 30546996 一致） |
| LXGW WenKai-Regular.ttf v1.522 | ✅ | `39AD71264B588165B469E35E6AFB162A378DACD1F95348160240BA9038AC3009` | 25,575,676 |
| LXGW WenKaiGB-Regular.ttf v1.522 | ✅ | `295568C131648062107543AA159C97DD49564BE791136C2ABF74CAD83EBA3F7F` | 25,819,540 |
| WenJinMincho-TTF.7z v2.100 | ✅ | `22AB30A4D175F9AA0DA3CC4303FEDB666081C9F6BDBCE267B8D9572F94231F49` | 23,646,320 |
| Yozai-Regular.ttf v0.868 | ✅ | `25071998A0FE6A72F54C235E714986D259633E5FF670B1A2B5E264387F3316AC` | 15,605,374 |
| 13_NotoSansMonoCJKsc.zip Sans2.004 | ✅ | `E252C39994F8A278676507600A955663C23C24A7827DC63A4300B2F7B427CD5D` | 27,750,553 |
| Source Han Sans/Serif | ✅ | 未复算 | 见上表 |
| Sarasa Gothic v1.0.42 | ✅ | 未复算 | 见上表 |
| **Chiron Hei HK / Sung HK** | ❌ **无任何 release 资产** | — | — |
| **TW-Kai / TW-Sung** | ❌ 非 GitHub（data.gov.tw），直链待固定 | — | 待固定 |
| **文泉驿微米黑** | ⚠️ 上游 SourceForge 对自动化抓取返回 403；Debian 池镜像可用 | — | 待固定 |
| LXGW Neo XiHei / Neo ZhiSong | 未枚举（标记待固定） | — | — |

---

## 六、明确警告 / EXPLICIT WARNINGS

1. **「免费商用」不等于「可随软件再分发」。这是本次调查最重要的结论。**
   已确证两款**完全落入此陷阱**：**MiSans** 与 **阿里巴巴普惠体**。两者都对外宣传「免费商用」，但许可原文只授权**下载/安装/使用**，并**明文/兜底禁止再分发字体文件**。**切勿因为厂商宣传「免费商用」就把它塞进安装包。**
   同类风险：**阿里妈妈系**（部分条款含「嵌入式使用」但同时禁止「有偿转让/许可给第三方」→ 有实质歧义）、**站酷字库**（「商业用途」指设计产出）。

2. **两处「仓库根 LICENSE 会骗人」的陷阱（自动化许可扫描必错）：**
   - `huawei-fonts/HarmonyOS-Sans` 的 `LICENSE` = **GPL-3.0**（那是 npm 包装代码的许可）。**字体真正的许可是 ZIP 内 `HarmonyOS_Sans_SC/LICENSE.txt`**，内容是一份明确允许 bundle 的专有许可。**判成 GPL-3.0 会误拒；判成宽松许可则可能忽略「不得修改（含子集化）」义务。**
   - `welai/glow-sans` 的 `LICENSE` = **MIT**（构建代码）。**字体本身是 OFL-1.1**（README 明示 + `OFL.txt`）。只看根 LICENSE 会误判为 MIT，从而**漏掉 OFL 的随附许可文本义务**。

3. **鸿蒙黑体虽然是「可捆绑」，但有硬性约束：**
   - 必须**显著注明使用了 HarmonyOS Sans**；
   - **不得修改字体 —— 因此不得子集化、不得格式转换、不得改名**（比 OFL 严格）；
   - 不得单独再分发/售卖；
   - 任何副本保留版权声明与协议全文；
   - 许可为 **`revocable`（可撤销）**、`non-transferable`。请法务知晓。
   - SC 单字重仅 8.26 MB，**疑似非 GB18030 全集**，请做实际缺字测试后再承诺「冷僻字无缺字」。

4. **霞鹜新晰黑/新致宋等 6 款 LXGW 字体不是 OFL，是 IPA Font License 1.0**，与 OFL 1.1 **互不兼容**。若用于嵌入式再分发，IPA 1.0 第 3.1(2) 条 + FAQ §3.3.2 **强制要求提供让用户换回 IPA 原始字体的手段，否则禁止再分发衍生字体**。作者本人建议改用 OFL 字体。**不要把它们和同门的「霞鹜文楷」混为一谈。**

5. **文泉驿正黑（Zen Hei）是 GPL-2 + 字体嵌入例外，但例外只保护「文档」，不保护「软件」。** 把它捆绑进闭源商业程序有 copyleft 风险 —— **拒绝**。同项目的**微米黑**因双许可可择 Apache-2.0 而安全，**两者结论相反，不要混淆**。

6. **许可为「可撤销/不可转让」的字体（MiSans、HarmonyOS Sans、阿里巴巴普惠体）在商业发布中是持续性风险**：即便今天允许，厂商也可变更或撤销。建议在法务备忘中登记，并在产品内保留「可替换字体」的架构余量。

7. **冷僻字覆盖不能靠猜。** 已确证的字集事实：
   - 极强：**Hanazono Mincho（107,518 字，含 CJK Ext B–F）**、**TW-Kai/TW-Sung（CNS11643 全字库）**、**思源/Noto CJK（GB18030 + Ext A–F）**、**文津宋体（大字符集宋体）**、**普惠体 3.0（194,460 全形汉字，GB18030-2022）**。
   - 偏弱/存疑：**HarmonyOS Sans SC（8.26 MB 单字重，疑非全集）**、**文泉驿微米黑**、**朱雀仿宋（5.5 MB）**、**得意黑/ChillRound/Iansui（常用简体）**、**钉钉进步体（仅 6,763 字 / GB2312）**。
   - 字形非简体规范：**Hanazono（日式）**、**TW-Kai（台湾标准）**、**Iansui（繁体向）** —— 只能当回退字体，不能当简体正文。

8. **构建可复现性建议：** 对每个选中的字重，写死 `releases/download/<tag>/<file>` 直链 + 上表 SHA-256 + 字节数三重校验；**不要用 `latest`**（Maple Mono 当前 latest 是 `v8.0-beta.3` 预发布版；Sarasa/Noto/LXGW 的 tag 也是可变的）。同时把 OFL 全文与各版权声明随安装器分发，并在「关于 → 开源许可」页集中展示（TW-Kai 的 OFL 分支要求**可离线阅读**，鸿蒙要求显著注明）。

---

## 七、未验证清单 / UNVERIFIED — 小结

以下条目**未能从权威一手来源确认**，因此在任何捆绑决策中**一律按「不可捆绑」处理**，直到补齐证据：
全瀨體、萩原流、有爱圆体、杨任东竹石体、屏显臻宋、悠宋、寒蝉活楷体、汇文明朝体、汇文正楷、京華老宋体 KingHwa_OldSong、OPPO Sans、vivo Sans、京东朗正体 JD LangZheng、仓耳今楷（及仓耳免费字体）、三极字库免费字体、康熙字典体、851 手写体、钉钉进步体、阿里妈妈刀隶体/方圆体/agile 的「嵌入式使用」范围、又拍云仿宋（疑似不存在）。

> **已从本清单移除：** ~~SuperHan 的 LICENSE 原文~~（已核实为 OFL-1.1）、~~抖音美好体 Douyin Sans~~（已核实为 OFL-1.1，见 `docs/font-license-verification/license-verification.json`）。

**证据文件位置：** `C:\QMAI_C\QMAI-main\.font-research\evidence\`（所有抓取原文、许可全文、PDF 抽取文本）
**脚本：** `.font-research\research.ps1`（检索/抓取）、`getlicenses.ps1`、`releases.ps1`、`sizes.ps1`、`pdftext.py`、`tarscan.py`、`decodejs.py`

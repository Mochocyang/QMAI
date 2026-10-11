# 修复：旧版本收不到应用内更新提示

> 缺陷范围：**v4.0.0 至 v4.1.1，共 6 个稳定版**
> 根因引入：2026-09-25 `26f80ee`（fix(ui): 调整对话输入框与界面资源）
> 修复日期：2026-10-07

## 1. 现象

用户在 GitHub 上发布了新版本，但打开旧版本时**不会提示更新**。只有手动进入
「设置 → 更新日志」点「检查更新」才能发现新版本。

## 2. 根因

`src/App.tsx` 的启动初始化流程里，`void checkForAppUpdate()` 这一行被删除了。

`26f80ee` 的 diff 显示，它在调整界面的同时一并删掉了：

```diff
-import { checkForAppUpdate } from "@/lib/app-updater"
-import { initAnalytics } from "@/lib/analytics"
...
       } finally {
         setLoading(false)
-        if (!IS_UI_TEST_BUILD) {
-          void checkForAppUpdate()
-          void initAnalytics()
-        }
       }
```

删除后，`checkForAppUpdate` 在整个仓库里**只剩它自己的定义**，没有任何调用者：

```
$ git grep -n checkForAppUpdate
src/lib/app-updater.ts:92:export async function checkForAppUpdate() {
```

于是 `app-updater.ts` 被 bundler 判定为不可达，**整体 tree-shake 掉**。这不是
"弹窗没弹出来"，而是那段代码根本没有进入安装包。

### 2.1 为什么守卫本身就无效（第二层缺陷）

原代码是 `if (!IS_UI_TEST_BUILD) { void checkForAppUpdate() }`。但
`src/lib/ui-test.ts` 里该常量已被硬编码为 `true`：

```ts
// UI 界面版本：已统一为只保留最新界面，恒为最新版。
export const IS_UI_TEST_BUILD = true
```

且 `vite.config.ts` 的 `define` 里**没有**对应条目（只有 `__APP_VERSION__`），
即不存在构建期替换。所以 `!IS_UI_TEST_BUILD` 恒为假 —— 即使当初没删调用，
条件也永远不成立。**恢复时若照抄那个守卫，等于没修**，而且 tsc 与测试都不报错。
修复采用无守卫形式（与 v3.2.16 的可用形态一致），非 Tauri 环境与非 Windows
平台由 `checkForAppUpdate` 内部自行返回。

## 3. 数据链路排查（确认断点唯一）

逐层验证，全部正常 —— 问题不在这些环节：

| 环节 | 验证方式 | 结果 |
|---|---|---|
| updater 插件 | `Cargo.toml` / `lib.rs` | `tauri-plugin-updater 2.11.0` 已注册 |
| 权限 | `capabilities/default.json` | `updater:default`、`dialog:allow-confirm` 齐全 |
| 公钥 | `tauri.conf.json` | 已配置 |
| 端点 | 直接请求 | 302 → `releases/tag/v4.1.1` |
| `latest.json` | 下载 v4.1.1 的资产 | version `4.1.1`、windows url 与签名齐全 |
| 版本比较 | 读插件源码 `updater.rs:578` | `release.version > current_version` |

结论：**唯一断点就是没人调用 `checkForAppUpdate()`**。

## 4. 为什么潜伏了 6 个版本

这是本次事故最值得记录的部分 —— 三重失效叠加：

1. **单元测试测不到"接线"**。`app-updater.test.ts` 的 4 个用例只测
   `runAppUpdateFlow` 的内部逻辑（拿到更新后怎么确认、下载、安装）。功能是否
   被接上不在任何断言射程内。
2. **这 4 个用例当时本来就是红的**。`01aab5f`（"收口测试专用旧模块和未使用
   导出"）把 `runAppUpdateFlow` 的 `export` 删了 —— 它只看了 src 里的非测试
   引用，没看出测试要 import 它。于是测试报
   `TypeError: runAppUpdateFlow is not a function`。在一个已有约 197 个失败的
   套件里，这 4 个红点不会引起任何注意。
3. **`app-updater` 从未被真正"编译"过**。因为整个模块被 tree-shake，任何语法级
   或类型级问题也不会在产物里暴露。

## 5. 修复内容

| 文件 | 改动 |
|---|---|
| `src/App.tsx` | 恢复 import 与启动调用（`finally` 块内，无恒假守卫） |
| `src/lib/app-updater.ts` | 恢复 `runAppUpdateFlow` 的 `export` |
| `src/lib/app-updater-wiring.test.ts` | 新增：接线回归测试（3 条） |
| `src/lib/app-updater-check.test.ts` | 新增：入口守卫与转发测试（5 条） |

## 6. 验证

### 6.1 产物级前后对照（最直接的机械证据）

`app-updater.ts` 独有的 5 条对话框文案，修复前在 `dist` 中**一个都没有**（证明
被 tree-shake），修复后全部出现：

| 文案 | 修复前 | 修复后 |
|---|---|---|
| 请稍后重试或前往 GitHub 手动下载安装包 | 0 | index-fyhUZ22r.js |
| 检测到新版本 | 0 | index-fyhUZ22r.js |
| 更新已下载完成 | 0 | index-fyhUZ22r.js |
| 准备安装 | 0 | index-fyhUZ22r.js |
| 稍后安装 | 0 | index-fyhUZ22r.js |

### 6.2 真实端到端（本机 release 版 + 桩更新服务）

用桩服务对外宣告 `9.9.9`（被测应用为 4.1.1），启动 release 版应用：

- 窗口枚举命中：`25812|#32770|发现新版本`（`#32770` 是 Windows 标准对话框类）
- 截图：`e2e/shot-update-dialog.png`，正文为
  「检测到新版本 9.9.9。是否立即下载并安装？」+ 更新说明 + 两个按钮
- 桩服务日志：`GET /latest.json`（应用确实发起了 HTTP 请求）

版本号 `9.9.9` 与更新说明文本只可能来自桩服务，构成不可预先伪造的证据。

### 6.3 真实端点验证（最强的一组证据）

前两节用的是桩端点。最后再用**真实 GitHub 端点**做一次闭环：

| 被测对象 | 自报版本 | 端点 | 结果 |
|---|---|---|---|
| 已发布的 v4.1.0 便携版（含 bug 的真实产物） | 4.1.0 | 真实 GitHub（最新 4.1.1） | **60 秒内无任何提示**（复现用户报告） |
| 修复版（临时把版本面改成 4.1.0 以触发更新判定） | 4.1.0 | 同上 | **弹出「发现新版本」**，正文为 4.1.1 + 14 条真实更新说明 |

- 复现截图：`e2e/shot-shipped-410-no-prompt.png`
- 修复后截图：`e2e/shot-real-endpoint-prompt.png`

两者端点、判定逻辑、界面完全相同，唯一差别是修复代码。这排除了"桩环境造成的
假阳性"，证明修复在真实发布链路上有效。验证后临时改动的三个版本文件
（`tauri.conf.json` / `Cargo.toml` / `Cargo.lock`）已全部还原，git 层面零改动。

### 6.4 受影响版本的用户如何恢复

自动检查在 v4.0.0–v4.1.1 失效，但**每一版都有可用的手动入口**，因此用户
升级一次即可恢复，不必手动下载安装包。逐版核实见
`check-manual-update-path.mjs`：

```
v4.0.0    有（触发方式：@tauri-apps/plugin-updater / handleCheckUpdate）
v4.0.1    有（触发方式：@tauri-apps/plugin-updater / handleCheckUpdate）
v4.0.2    有（触发方式：checkForChangelogUpdate）
v4.0.3    有（触发方式：checkForChangelogUpdate）
v4.0.4    有（触发方式：checkForChangelogUpdate）
v4.1.0    有（触发方式：checkForChangelogUpdate）
v4.1.1    有（触发方式：checkForChangelogUpdate）
```

路径：设置 → 更新日志 → 「检查更新」。

写入说明时的一处修正：该脚本第一版要求出现 `checkForChangelogUpdate`，
把 v4.0.0/v4.0.1 误判为"没有手动入口" —— 实际那两版用的是文件内的
`handleCheckUpdate()`，内部同样 `await check()`，入口完全可用（该函数在
v4.0.2 才被抽到 `changelog-update-session.ts` 并改名）。判据必须锚定
**能力**而非某个具体标识符，否则一次重构就会让检查给出反向结论。
这与 6.1 节拆书库 chunk 的锚点问题是同一类错误。

### 6.5 单元测试与变异证明

13 条用例通过；`prove-update-tests.mjs` 施加 5 项变异，5/5 如期变红：

| 变异 | 是否如期变红 |
|---|---|
| M1 再删掉 `runAppUpdateFlow` 的 export | 变红 |
| M2 从 App.tsx 删掉调用 | 变红 |
| M3 把调用套进恒假的 `if (!IS_UI_TEST_BUILD)` | 变红 |
| M4 去掉入口的 `!isTauri()` 守卫 | 变红 |
| M5 入口不转发给 `runAppUpdateFlow` | 变红 |

## 7. 已知未覆盖项（不是遗漏）

`updateCheckStarted` 并发守卫**没有测试覆盖**。原因：并发动态 `import()` 一个被
`vi.mock` 的模块，在本仓库的 vitest 5.0.1 下不可靠 —— 最小实验证明其中一次会拿到
**真实模块**：

```
Promise.all([import(m), import(m)])  →
  a.check = (...args) => checkMock(...args)      ← mock
  b.check = async function check(options) {...}  ← 真实模块
```

真实模块在 node 环境抛 `ReferenceError: window is not defined`，被
`checkForAppUpdate` 的 catch 吞掉。于是"被守卫挡住"与"落到真实模块上炸了"在断言
看来一模一样 —— 我写的第一版并发用例就是**假绿**的，去掉守卫照样通过。预热
import 也无效。已删除该用例并在测试文件里写明原因：假绿的用例比没有用例更糟，
它提供的正是让这个 bug 潜伏 6 个版本的虚假信心。

## 8. 同类风险排查

`initAnalytics()` 在同一提交中被一并删除，且至今未恢复。它是静默的在线统计上报
（device UUID、`/open`、60 秒心跳、`/close`），与本缺陷无关，本次**未擅自恢复** ——
请确认是否有意移除。

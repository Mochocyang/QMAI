# QMAI 4.2.0 发版核验（内部记录，不随发布外发）

> 本文件是**内部**核验记录：包含测试计数、提交 SHA、文件统计等不宜放进用户更新日志的内容。
> 面向用户的更新日志见同目录 `release-notes.md`；可直接发布的 Release 正文见 `release-body-github.md`。
> 之所以拆开：更新日志是给用户看的，写「718 个测试文件通过」对用户没有意义，反而会稀释真正重要的变更。

## 一、版本源（6 处同为 4.2.0）

| 文件 | 位置 |
|---|---|
| `package.json` | `version` |
| `package-lock.json` | 根 `version` |
| `package-lock.json` | `packages[""].version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | `name = "qmai"` 条目 |
| `src-tauri/tauri.conf.json` | `version` |

核验方式：直接读文本正则，不解析 JSON（`ConvertFrom-Json` 曾在锁文件上报错并造成**假绿**——逐项行没打印却汇总为「6/6 一致」，改用文本读取后才是真结果）。

## 二、发布前本地实跑

| 检查 | 命令 | 结果 |
|---|---|---|
| 更新日志非兜底 | `node scripts/release-notes.mjs 4.2.0` | 13 条真实条目，未命中 `QMAI 4.2.0 发布版本` 兜底文案 |
| 更新日志测试 | `npx vitest run src/lib/changelog.spec.ts scripts/release-notes.spec.mjs` | 2 文件 / 10 用例通过 |
| 全量 mock 测试 | `npm run test:mocks` | 718 文件 / 6934 用例通过，6 todo，exit 0 |
| 构建 | `npm run build`（typecheck + vite build） | 通过；`dist/assets/index-*.js` 与 `settings-view-*.js` 含 4.2.0 |
| 空白与冲突 | `git diff --check` | 干净 |

## 三、Git 交付

| 项目 | 值 |
|---|---|
| 合并提交 | `3020b11`（并入 `origin/main` 的 `3d4c86a`「Delete docs directory」，按用户选择保留 `docs/`） |
| 发布提交 | `a0cefd6`（`chore(release): 升级版本至 4.2.0`） |
| 标签 | `v4.2.0`（注解标签 `793bce92`，解引用 → `a0cefd6`） |
| 远端核验 | `origin/main` = `a0cefd6`；本地标签推送后由 `git ls-remote` 确认解引用 = `a0cefd6` |
| 推送顺序 | 先单独推 `main`，再单独推 `refs/tags/v4.2.0`（未同时推送） |
| 后续文档提交 | `212859a` 等 —— **未移动标签**（标签始终指向 `a0cefd6`） |

## 四、`docs/` 的处置（为什么不能照删）

远端 `3d4c86a` 删掉了整个 `docs/`（284 文件）。照删会让**两个已提交的测试**变红，因为它们是真实读取文件的：

- `src/components/uitest/ui-test-ai-input.spec.tsx:90` → `readFileSync(.../docs/ai-composer-nowrap-20261007/check-composer.mjs)`
- `src/lib/font-settings.spec.ts:76` → `readFileSync(.../docs/font-scaling-fix-20261007/font-availability.json)`

且这两个测试的**作用本身**就是「确认验收脚本还在、没被悄悄删掉」，删掉 docs 等于拆掉这两道守卫。此外 `scripts/sync-fonts-manifest.mjs` 以 `docs/.../bundled-fonts.json` 为字体哈希的唯一真相。

故合并采用 `-s ours`：记录合并关系（使 `origin/main` 成为祖先、可快进推送），但工作树完全保留本地版本 —— **docs 318 个文件一个不少**。

## 五、发布工作流

- 触发：推送 `v4.2.0` 标签触发 `QMAI Multi-Platform Release`（`on: push: tags: v*`）
- Run：`37952219898`
- 矩阵：Windows x64 / Linux x64 / macOS Apple Silicon
- `main` 的 `CI`：run `37952145903` → **success**

## 六、一处已更正的错误（记录在案）

`changelog.ts` 初稿把正文字号范围写成「15–32px」。核对 `src/lib/font-settings.ts` 后确认实际是：

- `BODY_FONT_PX_MIN = 12`、`BODY_FONT_PX_MAX = 32`、`DEFAULT_BODY_FONT_PX = 18`
- 15 只是**预设档**「小」的值（`BODY_FONT_PX_PRESETS` = 15 / 18 / 21 / 24），不是下限

原因：数值取自验收脚本的**测试输入值**（`正文15px` 是一档用例），而不是边界常量。已改为「起 12px、止 32px，预设 15/18/21/24」，并在条目里补上其余四项的真实区间（行距 1.2–2.6、字距 −1–6、左右边距 0–160、底部安全距离 0–240）。

**教训**：区间类断言要读**边界常量**，不要读测试用例里的取样值 —— 取样值恰好落在区间内，肉眼很难发现少说了下限。

## 七、档案文档清理的证据位置

见 `docs/remove-profile-rail-20261009/`：8 个模板、6+1 个已有文件、真机两条读取路径（伴生 `.html` / 内置模板即时渲染）、老格式地理卡判别器，以及被否决的「显示层剥离」为何不能采用。

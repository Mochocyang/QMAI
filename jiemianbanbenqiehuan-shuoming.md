# jiemianbanbenqiehuan 分支说明

## 分支用途

本分支用于独立开发和验证 QMAI 新版 UI（规格版），不直接在 `main` 上继续修改。新版 UI 必须与旧版 UI 双向可切换，并确保旧版数据不被污染。

## 使用要求

1. 新版 UI 默认不强制开启：没有本机偏好时，正式构建默认进入旧版 UI。
2. 旧版设置页提供“新版界面”入口；新版设置页提供“切换到旧版界面”入口。
3. 切换模式时提示关闭软件，用户确认后关闭；重新打开软件后按本机偏好进入对应 UI。
4. `VITE_QMAI_UI_TEST=1` 仅作为首次启动默认值；本机明确保存过切换偏好后，以本机偏好为准。
5. 新版继续使用独立数据目录 `QM-BOOK-UI-TEST`，并继续隔离 `recentProjects__uiTest`、`lastProject__uiTest`、`theme__uiTest` 等本机键。
6. 未通过完整回归验证前，不合并到 `main`，不推送 GitHub。
7. 分支说明、`docs/`、`dist-*`、`release-*`、`tests/`、日志和临时文件不进入正式发布上传范围。

## 本次更新内容

1. 增加本机 UI 版本偏好 `qmai-ui-test-mode`，支持旧版/新版 UI 切换。
2. 旧版设置 → 外观与界面 → 顶部“新版界面”卡片可切换到新版；新版设置页可切回旧版。
3. 切换确认文案改为：关闭后请重新打开软件，不承诺自动重启。
4. 本机明确保存的旧版偏好可以覆盖 `VITE_QMAI_UI_TEST=1` 的强制默认值。
5. 新增 `src/lib/ui-test.test.ts`，覆盖旧版默认、新版默认、偏好覆盖和写入本机偏好。
6. 清理本轮修改文件中误插入到源码中间的 UTF-8 BOM。
7. 删除新版 UI 最外侧画布留白、18px 圆角与投影，应用内容铺满窗口；窄屏同步取消外框效果。
8. 同时关闭 Tauri 原生窗口阴影，避免 Windows 在无装饰窗口外再次绘制 1px 边框。

## 验证状态

- `npm run typecheck`：通过。
- UI 测试专项：28 个测试文件 / 213 项通过。
- `npm run build`：通过。
- `npx tauri build --no-bundle`：通过。
- 默认构建未设置 `VITE_QMAI_UI_TEST`，产物默认走旧版。
- 全量 `npm run test:mocks`：22 个测试文件 / 136 项失败，集中在未修改的 text-chunker、app-updater、dedup、claude-cli-transport 等模块；未据此合并 `main`。

## 打包记录

- 版本：3.2.16
- 最新产物（已移除最外侧边框）：`C:\QMAI_C\QMAI-main\release-portable-uitest\QMaiWrite-UI-test-noouterframe-20260919-111420.exe`
- 文件大小：213406720 字节
- 最新 SHA-256：`B90C95A926D75F8AA9BDE0A8E84B514CE88BBB4F13C7E7E37A2422BC85DC18C3`
- 上一轮产物（保留备份）：`C:\QMAI_C\QMAI-main\release-portable-uitest\QMaiWrite-UI-test-noouterframe-20260919-105930.exe`
- 上一轮 SHA-256：`F38E80452A60998DD92B7E3885EFD5C7FEA7E020C549D81E7BD7256F83EEA3A3`

## 提交状态

- 是否提交：是（本分支本地提交）。
- 是否合并 `main`：否。
- 是否推送 GitHub：否。

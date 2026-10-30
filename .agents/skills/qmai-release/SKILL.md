---
name: qmai-release
description: Release a stable QMAI version by updating version metadata and changelog, pushing main, then creating and pushing an annotated version tag. Use when asked to bump, publish, or tag a QMAI stable release; do not use for prerelease builds or ordinary PR delivery.
---

# QMAI Stable Release

Use this workflow only in the `Mochocyang/QMAI` repository. Preserve the user's authorization boundary: preparing a release does not authorize pushing, tagging, or publishing unless the user requested those external mutations.

## Release invariants

- Push the release commit to `main` by itself. Never push `main` and the version tag in one command or atomic push.
- Do not wait for main CI before tagging. Main CI does not compile release binaries; only the tag workflow does.
- Never create the tag while local required validation is failing.
- Never overwrite, move, or force-push `main` or a release tag.
- Stop if `origin/main` moves away from the release commit before tagging. Reconcile the new remote state instead of tagging an older commit.
- Use an annotated tag named `v<package-version>` and verify that the remote tag resolves to the release commit.

## Workflow

1. Confirm the repository and release target.
   
   - Verify the remote is `Mochocyang/QMAI`.
   - Require a clean worktree before switching or pulling.
   - Fetch `origin/main` and tags, switch to `main`, and update with `--ff-only`.
   - Confirm the requested version is a stable semantic version and the tag does not already exist locally or remotely.

2. Update the complete QMAI release surface.
   
   - `package.json`
   - root package version and root package entry in `package-lock.json`
   - `src-tauri/Cargo.toml`
   - the `qmai` package entry in `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json`
   - `src/lib/changelog.ts`
   - `src/lib/changelog.spec.ts`
   - Derive release notes from commits since the previous version tag. Do not invent features or copy stale notes.

3. Validate before committing.
   
   - Confirm every version source has the exact requested version.
   - Run `node scripts/release-notes.mjs <version>` and inspect that it returns the intended Chinese notes rather than the generic fallback.
   - Run `npx vitest run src/lib/changelog.spec.ts scripts/release-notes.spec.mjs`.
   - Run `npm run test:mocks`, `npm run build`, and `git diff --check` unless the user explicitly narrows validation.
   - If a required check fails, do not tag. Separate a verified pre-existing baseline failure from a release regression and obtain explicit authorization before proceeding despite it.

4. Commit and push only `main`.
   
   - Use a Chinese Conventional Commit such as `chore(release): 升级版本至 <version>`.
   - Re-fetch `origin/main` immediately before pushing and confirm it is the release commit's parent.
   - Push only `main`. Record the exact release commit SHA.

5. Tag after `main` is on the release commit.
   
   - Fetch `origin/main` and tags again.
   - Require local `HEAD`, `origin/main`, and the recorded release SHA to match.
   - Reconfirm that `v<version>` does not exist.
   - Create an annotated tag on the recorded SHA, then push only that tag in a separate command.

6. Verify delivery.
   
   - Verify remote `main` and the dereferenced remote tag both resolve to the recorded release SHA.
   - Confirm `QMAI Multi-Platform Release` started for that tag and SHA.
   - Report the release workflow URL and current status. Do not claim release completion while jobs or required assets are pending.

GitHub上传前文件筛选要求

如果需要上传项目文件，必须先全面检查并筛选项目内容，只上传与软件直接相关的必要文件。

### 1. 允许上传的内容

只允许包含以下类型文件：

1. 源代码文件，例如：
* `.java`

* `.py`

* `.js`

* `.ts`

* `.tsx`

* `.rs`

* `.css`

* `.html`
1. 编译或构建配置文件，例如：
* `pom.xml`

* `package.json`

* `package-lock.json`

* `Cargo.toml`

* `Cargo.lock`

* `tsconfig.json`

* `vite.config.*`

* `tauri.conf.json`
1. 软件运行或界面展示必须依赖的资源文件，例如：
* 图标

* 样式表

* 字体

* 必要图片

* 必要配置资源
1. 软件功能实现直接依赖的配置文件。

### 2. 必须排除的内容

上传时必须排除以下内容：

1. 各类文档，例如：
* `README.md`

* .md文档

* 技术文档

* 用户手册

* 说明文档

* 临时整理文档

* 分支内容docs文档：比如：scratch-20261010-丙-2c-前置分析.md，character-skill-分支说明.md，superpowers文件夹，
1. 临时文件，例如：
* IDE 缓存

* 系统缓存

* 临时下载文件

* 临时脚本
1. 编译中间产物，例如：
* `dist`

* `build`

* `target`

* `.next`

* `.vite`
1. 测试数据，例如：
* 测试用例数据

* 模拟数据

* 临时样本数据
1. 日志文件，例如：
* `.log`

* 运行日志

* 调试日志
1. 版本控制相关内容，例如：
* `.git` 目录

* Git 内部对象

* 无关历史文件
1. 其他与软件功能实现无直接关联的内容。

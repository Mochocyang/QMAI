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

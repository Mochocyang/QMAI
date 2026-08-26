# shanchubutton 分支说明

## 分支用途

本分支为「拆书库生成内容删除按钮」功能分支。

## 使用要求

1. 本分支只开发「拆书库删除按钮」相关功能，不混入其他功能改动。
2. 拆书库中生成的内容（文风 Skill、角色 Skill、故事 Skill）均可删除。
3. 所有删除操作必须带二次确认弹窗；删除后内容移入「应用内回收站」（项目根目录 .trash，保留 30 天可恢复），不再永久删除。
4. 删除范围：
   - 文风 Skill：删除 style-profile.json 及配套 style.md；若该文风已启用，同时取消启用。
   - 角色 Skill：按角色删除，删除角色档案（characters/<id>.json）与对应生成的 Skill（skills/<名字>-skill.md）。
   - 故事 Skill：每张历史导图卡片可单独删除（整目录移入回收站）；删除最新一张时同步刷新根目录 story-map 引用。
5. 本分支必须保持稳定、可打包。
6. 开发完成后先运行源码，再验证旧功能不回退，最后再考虑打包。

## 更新记录

- 2026-08-26：创建分支，开始开发拆书库删除按钮功能。
- 2026-08-26：完成三个 Skill 的删除功能开发：
  - 文风 Skill：文风卡片新增「删除文风」按钮；删除 style-profile.json + style.md；若该文风当前已启用，删除时一并取消启用。
  - 角色 Skill：角色列表每个角色新增删除按钮（含删除角色档案与对应 Skill）；删除当前选中角色时自动清空选中态。
  - 故事 Skill：每张历史导图卡片新增「删除」按钮；删除最新一张时根目录 story-map 引用同步为剩余历史的最新一份，无剩余时移除根引用；非法目录名被拒绝。
  - 全部删除操作均带 window.confirm 二次确认弹窗。
  - 新增 deleteStoryMapHistory 单元测试 5 条；测试 mock deleteFile 改为支持递归删除目录（贴近真实命令行为）。
  - 验证：typecheck 通过；拆书库目录 43 个测试文件 340 条用例全部通过。
- 2026-08-26：删除改为移入应用内回收站（.trash），可恢复：
  - trash.ts 支持整目录移入与恢复（moveFileToTrash / restoreTrashItem）；故事导图整目录（story-map.json + html）一起回收。
  - deleteStoryMapHistory 增加 projectPath 参数，传入则移入回收站，否则保持原永久删除（兼容旧调用）。
  - 文风/角色/故事导图三个删除入口全部改走回收站，二次确认文案更新为「删除后将移入回收站，可恢复」。
  - 回收站列表与预览新增 kind 标签支持（skill → 技能/画像，storymap → 故事导图）。
  - 测试：trash.test.ts 新增目录移入/恢复 2 条；story-map-history.spec.ts 新增走回收站 1 条；共 17 条相关用例全部通过。
  - 验证：typecheck 通过；vite build 通过；tauri build 成功（release-portable/QMaiWrite.exe + version-info.json）。

## 提交状态

- 尚未提交（开发中）。

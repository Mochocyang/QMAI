# tongyidaochuzhongxin 分支说明

- 目标：设置中的统一导出中心。
- 范围：章节、大纲、拆书库、剧情推演室、灵魂作品；UTF-8 TXT / 真实 DOCX。
- 基线：d1d02d5。
- 分支：tongyidaochuzhongxin。
- 约束：TDD；只读源数据；不改无关模块；不打包；未经授权不提交或合并。
- 当前状态：已完成，未提交。
- 完成时间：2026-07-13 10:00:33。

## 本次完成内容

1. 新增统一导出类型、UTF-8 TXT 序列化与 Windows 文件名清理。
2. 新增真实 Office Open XML DOCX（ZIP + [Content_Types].xml + _rels/.rels + word/document.xml）。
3. 新增五类只读 Collector，保持自然顺序；拆书、推演和灵魂作品按作品生成独立文档。
4. 新增保存服务，取消保存不报错，写入失败显示中文错误。
5. 新增 Tauri 二进制写入命令，确保 DOCX ZIP 字节不会被文本编码破坏。
6. 设置页新增独立“导出中心”入口，支持项目、来源、格式选择；缺失来源禁用；处理中禁用操作；中文成功/失败提示；内容区可滚动。

## TDD 与验证

- 专项测试：5 个文件、36 个测试通过。
- settings 测试：10 个文件、34 个测试通过（含原有 settings 测试）。
- 源码启动：Vite ready，http://127.0.0.1:1422 返回 HTTP 200。
- typecheck：通过。
- build：通过；仅保留项目既有的动态导入与大 chunk 警告。
- git diff --check：通过。
- Rust 原始二进制写入测试与 base64 解码写入测试均已添加；指定 cargo test 仍被既有环境缺少 protoc 阻断，未进入本功能测试编译阶段，不能视为 Rust 端到端已验证。
- cargo fmt --check 已运行；由于全 crate 既有大量 rustfmt 差异（涉及 backup.rs、main.rs、proxy.rs 等无关文件）返回失败。单独检查 fs.rs 的 rustfmt 输出未命中本次 write_export_file/base64 新增区域，未自动格式化或改动无关 Rust 文件。
- 打包：按任务要求未执行。
- Git：未提交、未合并。
## 2026-07-13 规格审查修复

- 修复时间：2026-07-13 10:59:37。
- 章节顺序：优先 frontmatter chapter_number；缺失时按产品规则从显示标题/文件名提取自然序，最后按标题和文件名比较。
- 大纲顺序：与 KnowledgeTree 一致，显示标题优先 frontmatter title、再一级标题、再文件名；从显示标题提取章节/卷/数字排序，无序号时按中文标题比较。
- 剧情推演顺序：结构化结果按 report.createdAt 降序，与 framework-store 一致；无时间的兼容 Markdown 结果使用生成时间或文件名兜底。
- 二进制 IPC：前端将 TXT/DOCX 字节编码为 base64，Rust 解码后按原始字节写入；增加固定 base64 样本解码写入单测。
- 状态：修复完成，未提交、未合并、未打包。
## 2026-07-13 二次规格审查修复

- 修复时间：2026-07-13 11:15:35。
- 大纲不再先全局扁平化后按卷号排序；改为复现 KnowledgeTree 树顺序：同级目录优先于文件，目录按名称自然序，递归输出目录内容，同级文件按产品显示标题与序号规则排序。
- 无 frontmatter title、无一级标题时，文件名去扩展名并将短横线替换为空格，作为产品一致的显示标题。
- 新增嵌套目录与短横线文件名两项 RED→GREEN 测试。
- 最终专项测试：5 个文件、27 个测试通过；settings：10 个文件、34 个测试通过；typecheck、build、git diff --check、源码 HTTP 200 均通过。
- cargo fmt --check 仍因全 crate 既有 rustfmt 差异返回 1（输出 147 个 Diff in 差异片段，涉及多个无关 Rust 文件）；未自动格式化无关代码。
- Rust 指定 base64 单测仍在 lance-encoding 构建阶段因缺少 protoc 阻断，未进入本功能测试执行，不能声称 Rust 端到端通过。
- 状态：修复完成，未提交、未合并、未打包。
## 2026-07-13 第三次规格审查修复

- 修复时间：2026-07-13 11:33:07。
- 同级目录比较器改为与 KnowledgeTree 完全一致：left.name.localeCompare(right.name, "zh-CN")，不再使用 numeric collator；当前环境产品顺序为卷10在卷2前。
- 正文显示标题只识别一级 # 标题；二级至六级标题不再被当作显示标题，也不会从正文中删除。
- 仅有二级至六级标题时，显示标题回退为去扩展名并将短横线替换为空格后的文件名；低级标题完整保留在导出段落中。
- 新增目录比较器与低级标题保留两项 RED→GREEN 测试。
- 最终专项测试：5 个文件、28 个测试通过；settings：10 个文件、34 个测试通过；typecheck、build、git diff --check、源码 HTTP 200 均通过。
- cargo fmt --check 仍因全 crate 既有格式差异返回 1，本次输出 288 个差异片段、涉及 14 个 Rust 文件；未自动格式化无关代码。
- Rust 指定 base64 单测仍在 lance-encoding/lance-file 构建阶段因缺少 protoc 阻断，未进入本功能测试执行，不能声称 Rust 端到端通过。
- 状态：修复完成，未提交、未合并、未打包。
## 2026-07-13 代码质量审查修复

- 修复时间：2026-07-13 12:33:05。
- Rust 导出路径原样使用保存窗口路径，不再经过 resolve_project_storage_path；新增包含 wiki/.llm-wiki 的路径测试。
- 导出写入改为同目录临时文件、fsync、Windows MoveFileExW 原子替换（其他平台 rename）；失败保留旧文件并清理临时文件，成功/失败均有测试，Rust 测试自行清理临时文件。
- DOCX 过滤 XML 1.0 禁止控制字符，并用 DOMParser 解析 document.xml 验证无 parsererror。
- 前端与 Rust 增加 64 MiB 原始导出字节上限及中文超限错误；前端边界测试与 Rust 边界测试已添加。
- 五类来源改用 Promise.allSettled 隔离；灵魂作品只接受非 null、非数组对象；拆书章节回退逐文件隔离读取失败。
- 导出 UI 增加卸载 guard，停止后续保存窗口和卸载后状态更新；来源与格式使用 fieldset/legend。
- 文件名增加 Windows 设备名规避和 120 字符上限。
- settings-view 已恢复原 UTF-8 BOM，编码删除 diff 已消失。
- 最终专项测试：5 个文件、36 个测试通过；settings：10 个文件、35 个测试通过；typecheck、build、git diff --check、源码 HTTP 200 均通过。
- cargo fmt --check 仍因全 crate 既有格式差异返回 1，本次输出 292 个差异片段、涉及 14 个 Rust 文件；单独 rustfmt 检查输出未命中本轮 Rust 导出区域。
- cargo test write_export_file 仍在 lance-encoding/lance-file 构建阶段因缺少 protoc 阻断，未进入本功能 Rust 测试执行，不能声称 Rust 端到端通过。
- 状态：修复完成，未提交、未合并、未打包。

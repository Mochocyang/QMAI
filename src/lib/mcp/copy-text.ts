export function buildMcpConfigInstallText(executablePath: string): string {
  return [
    "请把青幕写作 MCP 加入当前 agent 的 MCP 配置（服务名 qmai，已有同名则覆盖），然后重新加载 MCP。",
    "",
    "启动命令：",
    `"${executablePath}" --mcp-stdio`,
    "",
    "应用需保持打开，并且设置里的 MCP 开关已打开。",
  ].join("\n")
}

export function buildSkillInstallText(skillDir: string, version: string): string {
  return [
    `请安装 qmai-mcp ${version}：将以下路径的目录整份复制到当前 agent 的 skills 目录（覆盖已有同名目录），然后重新加载 skill。`,
    "",
    skillDir,
  ].join("\n")
}

export const MCP_USAGE_EXAMPLES = [
  "写作对话 writing_conversation：message 必填。workflowMode 可以是 fast、standard、strict、discuss，model 是写作模型 id，reasoningDepth 可以是 auto、off、low、medium、high、max。这三项不传时用当前界面的写作模式、写作模型和思考深度，并且不改界面上的选择。",
  "保存文档 save_document：传入 projectPath、path 和完整 Markdown content。只原子保存章节或大纲，不排版，不提取记忆。编辑器里有未保存修改时会拒绝，除非 overwrite 为 true。",
  "修改标题 update_document_title：传入 projectPath、path 和 title。会同时改 frontmatter、一级标题和文件名。",
  "提取记忆 extract_memory：传入 projectPath 和 path。章节调用章节摄取，大纲调用大纲摄取。非正式章节默认拒绝，只有 allowDraft 为 true 才提取草稿。这一步不排版正文。",
  "章节排版 format_chapter：传入 projectPath 和章节 path。与编辑器「一键排版」相同：整理段落并给正文加首行缩进。大纲路径会拒绝。",
] as const

export interface ChangelogEntry {
  version: string
  date: string
  highlights: {
    en: string[]
    zh: string[]
  }
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.7",
    date: "2026-06-02",
    highlights: {
      en: [
        "Fixed theme color display issues, including white contrast in the blue theme and red accents in the dark theme.",
        "Saving a final chapter and extracting raw outline memory now generate snapshots and sync them to novel memory automatically, removing the old manual sync step.",
        "Added a feedback entry in Settings so users can submit issues and suggestions for backend review.",
        "Added a software usage guide in Settings with links to the complete guide, official user manual, and novel-writing introduction.",
        "Added a dismissible lower-left usage-guide prompt that opens the software usage guide directly.",
      ],
      zh: [
        "修复颜色设置中部分主题显示异常的问题，优化蓝色主题下白色文字/背景显示，并调整黑色主题中的红色效果。",
        "章节保存为正式章节后会自动生成快照并同步到小说记忆；大纲库提取原始记忆后也会自动生成快照并同步记忆。",
        "移除原本需要手动点击的“同步记忆”步骤，减少章节和大纲记忆整理时的重复操作。",
        "在设置中新增“反馈”入口，用户可以直接提交使用问题、建议或异常反馈，反馈内容会进入后台方便查看和处理。",
        "在设置中新增“软件使用说明”入口，内置完整使用说明、正式用户手册、小说功能介绍三个文档链接。",
        "在软件左下角新增“软件不知道怎么使用？点我”提示，点击后会直接进入设置中的“软件使用说明”页面，用户也可以手动关闭该提示窗。",
      ],
    },
  },
  {
    version: "1.0.5",
    date: "2026-06-01",
    highlights: {
      en: [
        "Added folder deletion to the outline tree context menu. Descendant outline markdown files are moved to trash before the folder itself is removed.",
        "When other non-outline files still remain in that folder, the app now keeps the folder and shows a warning instead of deleting it blindly.",
      ],
      zh: [
        "大纲列表右键菜单新增“删除文件夹”，会先把目录下所有大纲 Markdown 文档移入回收站，再删除空文件夹。",
        "如果文件夹里仍有未处理的其他文件，系统会保留文件夹本身并给出中文提示，避免误删。",
      ],
    },
  },
  {
    version: "1.0.4",
    date: "2026-06-01",
    highlights: {
      en: [
        "Fixed the streaming scroll lock in AI chat and AI outline sessions so you can scroll up to review earlier content while generation continues.",
        "Fixed file edit preview state so all detected outline edits can be displayed and applied instead of only the first result.",
      ],
      zh: [
        "修复 AI 会话和 AI 大纲会话在持续生成时滚动条被强制锁到底部的问题，现在可以自由向上查看历史内容。",
        "修复大纲批量修改预览状态不完整的问题，确保识别出的修改项能够完整显示并逐条应用。",
      ],
    },
  },
  {
    version: "1.0.3",
    date: "2026-06-01",
    highlights: {
      en: [
        "Added outline document import and folder import in the outline sidebar.",
        "Imported files now enter the outline library first, and initial memory extraction remains a manual user action.",
      ],
      zh: [
        "大纲侧边栏新增“导入文档”和“导入文件夹”功能，可以直接把外部资料整理进大纲库。",
        "导入后的内容默认只进入大纲库，不会自动提取记忆，仍由用户手动执行提取。",
      ],
    },
  },
  {
    version: "1.0.2",
    date: "2026-06-01",
    highlights: {
      en: [
        "Outline initial-memory extraction now keeps running in the background even if you switch away and come back later.",
        "Added one-click extract for the entire outline library, processing outline files one by one and saving a snapshot for each document.",
      ],
      zh: [
        "修复大纲库“提取初始记忆”切到其他页面后会中断的问题，返回后仍能保持正确的提取状态。",
        "大纲库新增“一键提取”，会按文档逐个提取初始记忆，并为每个大纲生成对应快照。",
      ],
    },
  },
  {
    version: "1.0.1",
    date: "2026-06-01",
    highlights: {
      en: [
        "Restored the memory center recent snapshot list to show the latest 10 items instead of stopping at 6.",
        "Cleaned up soul binding candidates so character binding only shows valid character entries and hides unrelated outline sections.",
      ],
      zh: [
        "修复记忆中心“最近章节快照”只显示 6 条的问题，现在会完整显示最近 10 条。",
        "修复角色灵魂绑定人物列表混入无关信息的问题，现在只显示可绑定的角色人物。",
      ],
    },
  },
  {
    version: "1.0.0",
    date: "2026-06-01",
    highlights: {
      en: [
        "Fixed the bug where AI generation could still pull stale memory after outline, graph, or snapshot updates.",
        "Snapshot sync now records revision metadata, archives superseded memory, and keeps current memory projections separate from history.",
        "Rollback now rebuilds the active entity, structured memory, cognition, character-state, and foreshadowing layers so restored memory becomes the default source again.",
      ],
      zh: [
        "修复大纲、图谱或快照更新后，AI 生成内容仍可能读取旧记忆数据的问题。",
        "同步记忆时新增快照版本元数据，并将历史归档与当前有效记忆投影分开管理。",
        "回滚历史快照时会同步重建当前实体页、结构化记忆、角色认知、人物状态与伏笔追踪，使恢复后的记忆重新成为默认读取来源。",
      ],
    },
  },
  {
    version: "0.4.20",
    date: "2026-06-01",
    highlights: {
      en: [
        "AI chat removed the old 'save as final chapter' and 'discard draft' buttons, while keeping 'save to chapter library' as the draft-saving path.",
        "AI outline generation added copy and regenerate actions, and now shows the referenced source materials more clearly.",
      ],
      zh: [
        "AI 会话删除“保存为正式章节”和“废弃草稿”按钮，保留“保存到章节库”作为草稿保存入口。",
        "AI 大纲生成新增复制、重新生成按钮，并补充引用资料展示。",
      ],
    },
  },
  {
    version: "0.4.19",
    date: "2026-05-31",
    highlights: {
      en: [
        "During AI generation you can scroll upward to inspect already generated content instead of being forced to stay at the bottom.",
        "Saving to the chapter library now creates a draft chapter and no longer triggers review or memory extraction immediately.",
        "The outline area added an AI outline button so you can chat against outlines and chapter content, then save the result as a new outline file.",
      ],
      zh: [
        "AI 生成时允许向上滚动查看已生成内容，不再强制锁定到底部。",
        "保存到章节库改为创建草稿章节，不再立即触发审查和记忆提取。",
        "大纲区新增 AI 大纲按钮，可基于大纲与章节内容对话，并将结果保存为新的大纲文档。",
      ],
    },
  },
  {
    version: "0.4.16",
    date: "2026-05-31",
    highlights: {
      en: [
        "Fixed character snapshot titles showing malformed chapter numbers like '-312'; they now display the correct outline name.",
        "Fixed the 'open outline' button so it returns you to the correct outline page.",
        "Renamed 'switch project' to 'switch novel', and added updater download progress plus an 'install now' action.",
      ],
      zh: [
        "修复人物小传快照标题显示异常章节号的问题，现在会正确显示对应大纲名称。",
        "修复“打开大纲”按钮点击后无法跳回大纲页面的问题。",
        "“切换项目”改为“切换小说”，并为更新功能补充下载进度和“立即安装”按钮。",
      ],
    },
  },
  {
    version: "0.4.15",
    date: "2026-05-31",
    highlights: {
      en: [
        "The status indicator in the lower-left corner now reflects model connectivity directly.",
        "Removed the web clipper port setting from network settings.",
        "Fixed a model connectivity URL construction bug that could leave the indicator stuck red.",
      ],
      zh: [
        "左下角状态指示器改为直接显示模型连接状态。",
        "移除网络设置中的网页剪藏端口配置。",
        "修复模型连接检测 URL 构建错误导致状态长期显示异常的问题。",
      ],
    },
  },
  {
    version: "0.4.13",
    date: "2026-05-31",
    highlights: {
      en: [
        "The outline module added a snapshot viewer so extracted initial memory can be opened and reviewed directly.",
        "Fixed the 'extract initial memory' button state so it stays accurate after switching away and returning.",
        "Settings changelog added complete version history and a check-for-updates entry point.",
      ],
      zh: [
        "大纲模块新增“查看快照”，提取初始记忆后可以直接打开并查看快照内容。",
        "修复“提取初始记忆”按钮状态无法保持的问题，切换页面后返回仍能显示正确状态。",
        "设置页更新日志新增完整版本历史和“检查更新”入口。",
      ],
    },
  },
  {
    version: "0.4.12",
    date: "2026-05-31",
    highlights: {
      en: [
        "Fixed the outline initial-memory entry in the memory center so it no longer shows a broken chapter label.",
        "Fixed character biography extraction so the corresponding memory-center card is no longer overwritten by a generic outline title.",
      ],
      zh: [
        "修复大纲提取初始记忆后在记忆中心显示异常章节标签的问题，现在会正确显示大纲名称。",
        "修复人物小传提取初始记忆后在记忆中心展示不正确的问题，不再被通用大纲标题覆盖。",
      ],
    },
  },
  {
    version: "0.4.11",
    date: "2026-05-31",
    highlights: {
      en: [
        "Added user statistics based on a Cloudflare Workers plus D1 deployment.",
      ],
      zh: [
        "新增用户统计能力，采用 Cloudflare Workers + D1 方案。",
      ],
    },
  },
  {
    version: "0.4.10",
    date: "2026-05-20",
    highlights: {
      en: [
        "Refocused the app as a novel-writing assistant around chapters, outlines, character state, foreshadowing, timelines, and graph views.",
        "Strengthened long-form writing support such as context continuity, chapter memory, and review checks to reduce forgotten details and setting conflicts.",
      ],
      zh: [
        "将产品定位更新为小说写作助手，围绕章节、大纲、人物状态、伏笔、时间线和图谱能力展开。",
        "强化写作上下文、章节记忆与审稿检查等长篇创作能力，减少遗忘和设定冲突。",
      ],
    },
  },
]

export function currentVersionChangelog(version: string): ChangelogEntry[] {
  return CHANGELOG.filter((entry) => entry.version === version)
}

export function allChangelog(): ChangelogEntry[] {
  return CHANGELOG
}

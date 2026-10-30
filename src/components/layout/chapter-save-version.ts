import { extractChapterNumber } from "@/lib/novel/chapter-utils"
import { pruneVersions, saveVersion } from "@/lib/novel/version-store"

/** 从完整路径取文件名并去掉 `.md` 扩展名（只取最后一段，兼容 Windows 反斜杠）。 */
function fileNameStem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.md$/i, "")
}

/**
 * 编辑器保存章节前的历史版本钩子。
 *
 * 抽成独立函数是为了可单测：preview-panel 有六千多行，
 * 挂载它来验证"保存前有没有留版本"成本太高、也太脆。
 *
 * 历史版本是「保险」而非「主流程」：写不进去只能说明这次没有回退点，
 * 但绝不能挡住用户的正文保存——所以任何失败都只记日志，不向外抛。
 */
export async function snapshotChapterBeforeSave(input: {
  projectPath: string
  path: string
  previousContent: string
}): Promise<void> {
  const { projectPath, path, previousContent } = input
  // 没内容可回退：新文件第一次保存、或旧文件本来是空的，不留版本。
  if (previousContent.trim() === "") return

  const key = extractChapterNumber(fileNameStem(path))

  try {
    await saveVersion({
      projectPath,
      kind: "chapter",
      key,
      content: previousContent,
    })
  } catch (error) {
    console.warn("[history] 保存章节历史版本失败（不影响本次保存）：", path, error)
    return
  }

  // 清理旧版本不 await：它只是容量/时效维护，和这次保存结果无关，
  // 等它跑完会白白拖慢保存。失败也只记日志。
  void pruneVersions(projectPath, "chapter", key).catch((error) => {
    console.warn("[history] 清理章节历史版本失败：", path, error)
  })
}

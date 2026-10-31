/**
 * 大纲页中栏的「人物面板」外壳。
 *
 * ── 为什么要单独抽出来 ──
 * 大纲页的中栏并非只有一处渲染点：正式版走 `OutlineWorkbench`，
 * 测试皮肤走 `UiTestWorkspace`（`ui-test-editor-slot`），写作页走 `WritingWorkspace`。
 * 只改一处会漏（曾经只改了 `WritingWorkspace`，而大纲页根本不用它）。
 */
import { useEffect, useRef } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { PersonaSkillView } from "./persona-skill-view"

export function PersonaPane() {
  /*
   * 用户去点文件树里的文档时收起人物面板 —— **所有**中栏渲染点都要这一条。
   * 早一版只写在 WritingWorkspace 里，大纲页（OutlineWorkbench）没有，
   * 于是打开过人物之后，再点「伏笔大纲」这类文档就打不开了（用户实测）。
   * 放进 PersonaPane，它就跟着面板走，加到哪都不会漏。
   */
  const setPersonaOutlinePane = useWikiStore((s) => s.setPersonaOutlinePane)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const previousFileRef = useRef<string | null>(selectedFile ?? null)

  useEffect(() => {
    const previous = previousFileRef.current
    previousFileRef.current = selectedFile ?? null
    if (previous !== (selectedFile ?? null)) setPersonaOutlinePane(null)
  }, [selectedFile, setPersonaOutlinePane])

  return (
    <div className="h-full min-h-0" data-testid="persona-pane">
      <PersonaSkillView paneMode />
    </div>
  )
}

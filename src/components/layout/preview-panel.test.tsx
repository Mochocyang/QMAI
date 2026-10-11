import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "preview-panel.tsx"), "utf8")

/**
 * 剥掉注释后的源码。
 *
 * `not.toContain(...)` 这类**否定**断言只有对着它跑才有判别力：
 * 原始源码里 `setLastChapterDeAiSkill` 出现在注释与代码两处，
 * 直接断言"不含某标识符"会因为注释里的同名字符串而假红 / 假绿，
 * 与真实行为无关。小状态机认引号，避免把字符串里的 `//` 当注释起始。
 */
function stripComments(text: string): string {
  let out = ""
  let index = 0
  const quoteStack: string[] = []
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    const quote = quoteStack[quoteStack.length - 1]
    if (quote) {
      if (char === "\\") {
        out += text.slice(index, index + 2)
        index += 2
        continue
      }
      if (char === quote) quoteStack.pop()
      out += char
      index += 1
      continue
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
      continue
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2)
      index = end < 0 ? text.length : end + 2
      continue
    }
    if (char === '"' || char === "'" || char === "`") quoteStack.push(char)
    out += char
    index += 1
  }
  return out
}

const code = stripComments(source)

/**
 * 丁-2「文风写作」在**章节区**这条路径上的接线。
 *
 * 为什么这里守住源码而不是渲染：章节区生成（`runDeepChapterGeneration`）是从
 * `preview-panel.tsx` 直接调的，**不经过** agent/getter 链，所以「选择器选了什么」
 * 到「生成本次用哪条文风」之间没有任何别的模块可以替它担保 ——
 * 只有这一处赋值。渲染整块 PreviewPanel 需要项目、章节树、Tauri IPC 全套假件，
 * 而断言的对象仍是同一行文本。
 */
describe("章节区的「文风写作」接线", () => {
  it("把本章临时选择的文风 id 交给生成输入（只此一次生成）", () => {
    expect(source).toContain("writingStyleIdOverride: chapterWritingStyleId")
    expect(source).toContain("const [chapterWritingStyleId, setChapterWritingStyleId] = useState<string | null | undefined>(undefined)")
  })

  it("选择进了生成的 useCallback 依赖，改了选择才会用新值重跑", () => {
    /*
     * 找**紧跟在 `writingStyleIdOverride: chapterWritingStyleId` 之后**的那个
     * 依赖数组，而不是全局第一处 `}, [bumpDataVersion,`：文件里有多个
     * `bumpDataVersion` 开头的依赖数组，取第一个会指向无关回调
     * （实测：拿到的是 `chapterExternalUpdateCoordinator` 那条）。
     */
    const lines = code.split(/\r?\n/)
    const assignmentAt = lines.findIndex((line) => line.includes("writingStyleIdOverride: chapterWritingStyleId"))
    expect(assignmentAt, "应能定位到生成输入里的覆盖赋值").toBeGreaterThan(-1)
    const depsAt = lines.findIndex((line, index) => index > assignmentAt && line.includes("}, ["))
    expect(depsAt, "覆盖赋值之后应有该回调的依赖数组").toBeGreaterThan(-1)
    expect(
      lines[depsAt],
      "依赖数组漏了 chapterWritingStyleId ⇒ 改了选择仍用闭包里的旧值",
    ).toContain("chapterWritingStyleId")
  })

  it("工具栏里的选择器是图标态，且与状态双向绑定", () => {
    expect(source).toContain("<WritingStylePicker")
    expect(source).toContain("value={chapterWritingStyleId}")
    expect(source).toContain("onChange={setChapterWritingStyleId}")
    expect(source).toContain("iconOnly")
  })

  /*
   * 用户决定 2 的直接守卫：项目设置不得被改。
   *
   * 与旁边的 `setLastChapterDeAiSkill` 先例**故意不同**：写「上次用的文风」
   * 只能落进项目级 `.qmai/writing-style.json`（文风库与启用态同文件），
   * 那既把临时选择变成跨会话持久状态，也让"生成有没有写项目设置"变得难判。
   */
  it("不把这次选择落盘：既不记住上次用的文风，也不写文风库", () => {
    expect(code).not.toContain("setLastChapterWritingStyle")
    expect(code).not.toContain("setEnabledWritingStyle")
    expect(code).not.toContain("upsertWritingStylePreset")
    expect(code).not.toContain("rememberChapterWritingStyle")
    // 命名/调用形态的任何一种复用都要挡住（含 hook 形式）
    expect(code).not.toMatch(/useLastChapterWritingStyle|LastChapterWritingStyleId/)
  })

  /*
   * ⚠️ 这条断言**方向被审查推翻了**，如实记下以免后来者再翻回去。
   *
   * 原先这里写的是 `expect(code).not.toContain("setChapterWritingStyleId(undefined)")`
   * —— 意思是「章节文风选择刻意不重置」。那是把一处**静默失效**记成了设计：
   * 若选择跟着组件实例活过一次项目切换，覆盖就仍是上一个项目的 preset id，
   * `resolveWritingStylePreset` 对未知 id 返回 `null`（那是**生成侧**刻意且已
   * 文档化的选择，不推翻），于是覆盖文本变成 `""`，反而把新项目**本来启用**的
   * 文风压掉；而章节区选择器是 `iconOnly`，正文里看不出任何变化。
   *
   * 「不落盘」和「跨项目重置」是**两件不同的事**，前者推不出后者：
   * 用户没碰选择器，就不该有任何覆盖。所以现在按相邻的
   * `setChapterDeAiSkillId(undefined)` 先例**加上重置**，并把断言翻正。
   *
   * （可达性：当前 shell 换项目会连工作区一起卸载，所以这条在今天是
   * 契约/防将来，不是正在发生的 bug —— 理由与出处写在
   * `preview-panel.tsx` 那个 effect 的注释里，别在这里重复一份。）
   */
  it("换项目时清空本次文风选择（与相邻的去AI味 Skill 选择同一处 effect）", () => {
    expect(code).toContain("setChapterWritingStyleId(undefined)")
    expect(code).toContain("setChapterDeAiSkillId(undefined)")
    // 两者共用一个以项目路径为依赖的 effect：同一个重置点，不会再漏一个
    expect(code).toMatch(
      /setChapterDeAiSkillId\(undefined\)\s*\n\s*setChapterWritingStyleId\(undefined\)\s*\n\s*\}, \[project\?\.path\]\)/,
    )
  })

  /*
   * 重置的反向守卫：依赖必须是 `project?.path`。
   *
   * 若依赖被写成 `[]`，effect 只在挂载时跑一次 —— 换项目不再重置，正是上面那条
   * 要修的静默失效；若有人把依赖数组整个删掉，就变成每次渲染都重置，
   * 把「同项目内连续生成沿用选择」变成「每次生成都重置」。
   * 两个方向都错，所以这里单独钉住依赖。
   */
  it("重置只在项目路径变化时发生，不是每次生成都重置", () => {
    const afterSetter = code.split("setChapterWritingStyleId(undefined)")[1] ?? ""
    expect(
      afterSetter.slice(0, 60),
      "文风选择的重置必须挂在 [project?.path] 上",
    ).toContain("[project?.path])")
  })
})

describe("preview-panel final chapter save state", () => {
  it("scopes saved state by projectPath and filePath", () => {
    expect(source).toContain("finalChapterSave.projectPath === project?.path")
    expect(source).toContain("finalChapterSave.filePath === selectedFile")
  })

  it("writes final chapter save progress through the shared store", () => {
    expect(source).toContain("setFinalChapterSave")
    expect(source).toContain("projectPath,")
    expect(source).toContain("filePath:")
  })

  it("uses phase codes instead of translated labels for final save progress", () => {
    expect(source).toContain("phase: FinalChapterSavePhase")
    expect(source).toContain("phaseLabelMap")
  })

  it("flushes chapter filenames before leaving a chapter", () => {
    expect(source).toContain("flushChapterBeforeLeave")
    expect(source).toContain("previousFile !== selectedFile")
    expect(source).toContain("syncChapterToCanonicalPath")
  })

  it("supports selected-text transform previews", () => {
    expect(source).toContain("TextTransformPreviewDialog")
    expect(source).toContain("handleSelectionAction")
    expect(source).toContain("replaceChapterBodySelection")
    expect(source).toContain('comparisonMode={selectionTransformAction === "de-ai"}')
    expect(source).toContain('onCandidateContentChange={selectionTransformAction === "de-ai" ? setSelectionTransformCandidateContent : undefined}')
  })

  it("shows the actual skill used by de-AI actions", () => {
    expect(source).toContain("chapterDeAiSkillName")
    expect(source).toContain("selectionTransformSkillName")
    expect(source).toContain("当前去AI味 Skill")
    expect(source).toContain("本次使用 Skill")
  })

  it("keeps the chapter de-AI toolbar button label short while preserving the skill picker state", () => {
    expect(source).toContain("chapterDeAiOptions.effectiveName")
    expect(source).toContain('const chapterDeAiButtonLabel = currentChapterDeAiProcessing ? "处理中" : "去AI味"')
    expect(source).not.toContain("`去AI味：${chapterDeAiSkillName}`")
    expect(source).toContain("currentSkillId={chapterDeAiOptions.currentSkillId}")
    expect(source).toContain("defaultSkillId={chapterDeAiOptions.defaultSkillId}")
  })

  it("does not expose the cognition panel from the chapter toolbar", () => {
    expect(source).not.toContain("setShowCognition(true)")
    expect(source).not.toContain('t("preview.cognitionTitle")')
  })

  it("persists the last picked chapter de-AI skill in the project skill config", () => {
    expect(source).toContain("setLastChapterDeAiSkill")
    expect(source).toContain("saveDeAiSkillConfig(project.path")
  })

  it("uses the shared de-AI skill option loader for chapter skill state", () => {
    expect(source).toContain("useDeAiSkillOptions")
    expect(source).toContain("useLastChapterSkill: true")
  })

  it("keeps chapter de-AI processing clear when remembering the picked skill fails", () => {
    expect(source).toContain("未能记住本次去AI味 Skill 选择，本次处理仍会继续")
    expect(source).not.toContain("setSaveStatus(\"保存章节去AI味 Skill 选择失败\")")
  })

  it("resets the remembered chapter de-AI skill when switching projects", () => {
    expect(source).toContain("setChapterDeAiSkillId(undefined)")
    expect(source).toContain("}, [project?.path])")
  })

  it("reports remember-skill failures without replacing de-AI processing state", () => {
    expect(source).toContain('toast.error("未能记住本次去AI味 Skill 选择，本次处理仍会继续")')
    expect(source).not.toContain("deAiSkillMemoryWarning")
    expect(source).not.toContain("setDeAiSkillMemoryWarning")
  })

  it("closes the chapter de-AI skill picker when clicking outside it", () => {
    expect(source).toContain("deAiSkillPickerRef")
    expect(source).toContain("handleDeAiSkillPickerMouseDown")
    expect(source).toContain('document.addEventListener("mousedown", handleDeAiSkillPickerMouseDown)')
    expect(source).toContain('document.removeEventListener("mousedown", handleDeAiSkillPickerMouseDown)')
  })

  it("anchors the chapter de-AI skill picker near the clicked toolbar button", () => {
    expect(source).toContain("deAiSkillPickerPosition")
    expect(source).toContain("getDeAiSkillPickerPosition")
    expect(source).toContain("openDeAiSkillPicker(null, e.currentTarget)")
    expect(source).not.toContain('className="fixed right-6 top-20')
  })

  it("uses a local draft for chapter title editing", () => {
    expect(source).toContain("chapterTitleDraft")
    expect(source).toContain("chapterTitleEditing")
    expect(source).toContain("commitChapterTitleDraft")
    expect(source).toContain("e.currentTarget.blur()")
    expect(source).toContain("e.stopPropagation()")
  })

  it("measures chapter title width for header metadata layout", () => {
    expect(source).toContain("titleMeasureRef")
    expect(source).toContain("chapterTitleWidthPx")
    expect(source).toContain("chapterStatusMeta")
    expect(source).toContain("chapterWordCountMeta")
    expect(source).toContain('chapterHeader.status === "final"')
  })

  it("lets the chapter toolbar span the preview header so actions stay right aligned", () => {
    expect(source).toContain('ref={chapterToolbarRef} className="flex min-w-0 flex-1 items-center gap-2"')
    expect(source).toContain('className="relative ml-auto flex shrink-0 items-center justify-end gap-1"')
  })

  it("keeps the draft badge lightweight in the chapter header", () => {
    expect(source).toContain('chapterHeader.status === "draft"')
    expect(source).toContain("rounded-full border border-border/70 bg-muted/60")
  })

  it("falls back to the filename when the chapter heading is missing", () => {
    expect(source).toContain("chapterDisplayTitle")
    expect(source).toContain("getChapterTitleFromPath")
  })

  it("does not render total chapter word count in the header", () => {
    expect(source).not.toContain("chapterTotalWordCountMeta")
    expect(source).not.toContain("buildChapterTotalWordCountLabel")
    expect(source).not.toContain("totalChapterWords")
  })

  it("does not render the archived-draft action anymore", () => {
    expect(source).not.toContain("canArchiveDraft")
    expect(source).not.toContain("handleArchiveDraft")
    expect(source).not.toContain('t("novel.chapter.archiveDraft")')
  })

  it("does not apply a saved draft tree after the active project changes", () => {
    expect(source).toContain("const draftProjectId = project.id")
    expect(source).toContain("useWikiStore.getState().project?.id === draftProjectId")
  })

  it("does not mount a newly selected markdown file before it loads", () => {
    expect(source).toContain("loadedFilePath")
    expect(source).toContain("loadedFilePath !== selectedFile")
    expect(source).toContain("setLoadedFilePath(selectedFile)")
  })

  it("skips redundant chapter flushes when markdown is unchanged", () => {
    expect(source).toContain("shouldSyncChapterOnLeave")
    expect(source).toContain("if (!shouldSyncChapterOnLeave(path, markdown, lastLoadedForPath)) return")
  })

  it("persists outline ingest progress through the shared outline task flow", () => {
    expect(source).toContain("startOutlineIngestTask")
    expect(source).toContain("currentOutlineTask")
    expect(source).toContain('task.status === "ingesting" || task.status === "done" || task.status === "error"')
  })

  it("strips frontmatter from trash markdown previews", () => {
    expect(source).toContain('const trashPreviewBody = category === "markdown"')
    expect(source).toContain("? parseFrontmatter(fileContent).body")
    expect(source).toContain("<WikiReader body={trashPreviewBody} />")
  })
})

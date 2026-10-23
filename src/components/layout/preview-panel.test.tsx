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
 * 丁-2「文风写作」在章节区这条路径上**已被用户要求删除**。
 *
 * 改造前这里是一整组断言，钉的是：选择器的值 → 生成输入的
 * `writingStyleIdOverride` → useCallback 依赖 → 换项目清空。
 * 用户在定稿截图里要求「每个章节的上面不需要显示『文风』的图标，
 * 将『文风』的图标删除」，于是那套接线连同状态一起删掉了
 * （为什么不走渲染断言、只走源码断言，理由与改造前一致：
 *  章节区生成是 `preview-panel.tsx` 直接调的，不经过 agent/getter 链，
 *  选择器到本次生成之间没有别的模块能替它担保，而渲染整块 PreviewPanel
 *  需要项目、章节树、Tauri IPC 全套假件，断言的对象却仍是同一行文本）。
 *
 * ⚠️ 这些守卫改成钉**删除本身**，而不是把整组断言删掉。
 * 直接删掉的后果是：把选择器加回来会变成一次**没有任何测试变红**的改动 ——
 * 而它恰恰是这次删除最可能被回滚的地方（组件还在、生成入参还在、
 * 对话侧那条路也还在，加回来只要几行）。钉住删除 = 要加回来必须
 * 有意识地来改这组断言，也就必须重新读一遍上面那段取舍。
 *
 * ⚠️ 否定断言一律对着 `code`（剥掉注释的副本）跑，不对着 `source`：
 * 上面那段说明与 `preview-panel.tsx` 里的取舍注释都写着这些标识符，
 * 对着 `source` 断言"不含"会因为**注释里的同名字符串**而假红。
 */
describe("章节区不再有「文风写作」选择器（用户要求删除）", () => {
  it("工具栏不渲染文风选择器，也不再有本次生成用的文风状态", () => {
    expect(code, "「文风」图标已按用户要求从章节工具栏删除").not.toContain("<WritingStylePicker")
    expect(code).not.toContain("chapterWritingStyleId")
    expect(code).not.toContain("setChapterWritingStyleId")
  })

  it("章节区生成不再传 writingStyleIdOverride（省掉该键 = 不覆盖）", () => {
    /*
     * 省掉这个键与传 `undefined` **完全等价**：`deep-chapter-generation.ts`
     * 的判据是 `=== undefined` 表示"不覆盖"，`run-chapter-workflow.spec.ts`
     * 也钉着"没有产出者时必须是 undefined"。所以这里钉"整个键不出现"，
     * 而不是"值是 undefined" —— 后者会让人以为还要有个占位。
     */
    expect(code).not.toContain("writingStyleIdOverride")
  })

  /*
   * ⚠️ 这条是**跨模块**断言，方向和上面几条相反：文风能力本身没有被拆掉。
   *
   * 删的只是章节区这一个产出端。若将来有人顺手把 `WritingStylePicker`
   * 组件或生成入参也一并删了，就会连带打断**对话 / 写作助手**那条仍在用的路
   * （`chat-panel.tsx` 的 `getWritingStyleIdOverride` → `run_chapter_workflow`）。
   * 用户要的是"章节顶栏不要这个图标"，不是"取消文风功能"。
   */
  it("文风能力本身仍在：选择器组件与生成入参都留给对话侧使用", () => {
    expect(
      readFileSync(resolve(__dirname, "../skill-library/writing-style-picker.tsx"), "utf8"),
      "WritingStylePicker 组件必须还在（文风库仍要用它）",
    ).toContain("export")
    expect(
      readFileSync(resolve(__dirname, "../../lib/novel/deep-chapter-generation.ts"), "utf8"),
      "生成入参 writingStyleIdOverride 必须还在（对话侧仍要传）",
    ).toContain("writingStyleIdOverride")
  })

  /*
   * 去AI味 Skill 的跨项目重置**没有**被删：它和文风选择原本共用一个
   * 以项目路径为依赖的 effect，现在只剩它自己。
   * 若有人把整段 effect 一起当成"文风的东西"删掉，
   * 旧项目的 Skill 选择就会作用在新项目上 —— 这条挡住那种误删。
   */
  it("去AI味 Skill 的跨项目重置仍然保留", () => {
    expect(code).toContain("setChapterDeAiSkillId(undefined)")
    expect(
      code,
      "重置必须仍挂在 [project?.path] 上：依赖丢了就变成每次渲染都重置",
    ).toMatch(/setChapterDeAiSkillId\(undefined\)\s*\n\s*\}, \[project\?\.path\]\)/)
  })

  /*
   * 用户决定 2 的直接守卫：项目设置不得被改。
   *
   * 与旁边的 `setLastChapterDeAiSkill` 先例**故意不同**：写「上次用的文风」
   * 只能落进项目级 `.qmai/writing-style.json`（文风库与启用态同文件），
   * 那既把临时选择变成跨会话持久状态，也让"生成有没有写项目设置"变得难判。
   *
   * ⚠️ 选择器删掉之后这条**仍然要留着**：它现在的含义从
   * "这次选择不落盘"变成"别为文风在章节区新开一条落盘路径"。
   * 真要加回文风选择时，最容易顺手做的错事就是把它持久化。
   */
  it("不把章节区的文风选择落盘：既不记住上次用的文风，也不写文风库", () => {
    expect(code).not.toContain("setLastChapterWritingStyle")
    expect(code).not.toContain("setEnabledWritingStyle")
    expect(code).not.toContain("upsertWritingStylePreset")
    expect(code).not.toContain("rememberChapterWritingStyle")
    // 命名/调用形态的任何一种复用都要挡住（含 hook 形式）
    expect(code).not.toMatch(/useLastChapterWritingStyle|LastChapterWritingStyleId/)
  })
})

describe("preview-panel final chapter save state", () => {
  it("scopes saved state by projectPath and filePath", () => {
    expect(source).toContain("finalChapterSave.projectPath === project?.path")
    expect(source).toContain("finalChapterSave.filePath === selectedFile")
  })

  /*
   * ── 标题行徽章以「记忆是否已提取」为准（用户口径）──
   *
   * 缺陷现场：第 6、15 章的文件里写着 `chapter_status: final`（批量导入落下的），
   * 但没有 `.novel/snapshots/` 快照，于是侧栏那一行没有绿点、
   * 标题行徽章却是绿色「正式」。
   *
   * 这三条各自守一环，少任何一环徽章都会退回错误语义：
   *   1. 取号走共享解析器（与侧栏绿点同一个），不是 frontmatter 的 chapter_number；
   *   2. 快照号从 `.novel/snapshots` 目录读；
   *   3. 口径通过 `memoryExtracted` 交给 buildChapterEditorHeader
   *      —— 摘掉它，`status` 就退回读 `chapter_status`，缺陷原样复现。
   */
  it("标题行徽章以记忆快照为准，与侧栏绿点共用同一套取号规则", () => {
    expect(source).toContain("resolveChapterDotNumbers")
    expect(source).toContain("resolveChapterMemoryDotState")
    expect(source).toContain("chapterSnapshotNumbersFromFileNames")
    expect(source).toContain("chapterSnapshotNumbersFrom")
    expect(source).toContain("/.novel/snapshots")
    expect(source).toContain("{ memoryExtracted: chapterMemoryExtracted }")
  })

  /*
   * 提取成功落盘的是**快照**，`fileContent` 与 `dataVersion` 都可能不变，
   * 所以必须有一个显式信号让徽章重读。
   *
   * ⚠️ 这个信号**不能**是 `currentFinalChapterSave?.phase`：
   * 保存为正式章节会顺带把文件改名（`renameToCanonical: true`），
   * `updatePhase` 记下的 `filePath` 是改名后的路径，于是
   * `currentFinalChapterSave`（要求 `filePath === selectedFile`）变成 null，
   * 依赖值不变 → 快照已落盘而徽章仍显示「草稿」。
   */
  it("提取完成后重读快照：用一个与文件路径无关的显式信号", () => {
    expect(source).toContain("[project, dataVersion, memorySnapshotVersion]")
    expect(source).toContain("setMemorySnapshotVersion((version) => version + 1)")
    // 反向：不得退回那个会因改名而失效的依赖
    expect(source).not.toContain("currentFinalChapterSave?.phase]")
  })

  /*
   * 「提取记忆」在**草稿**章上必须一路走到提取。
   *
   * 改造前它只调 `handleSaveAsFinal()`（写 `chapter_status: final` 就收工），
   * 于是按钮名字说「提取记忆」、实际不提取 —— 而徽章已改成以快照为准，
   * 用户点一次会看到徽章纹丝不动地停在「草稿」。
   */
  it("草稿章的「提取记忆」按钮一次点击即完成提取", () => {
    expect(source).toContain("handleSaveAsFinal({ thenExtract: true })")
    // 反向：菜单项的「保存为正式章节」仍不得触发任何提取
    expect(source).not.toContain("handleSaveAsFinal({ thenExtract: true }) }>保存为正式章节")
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

  it("大纲粘贴细纲后不会丢：短延迟落盘、切走/卸载时 flush、提取记忆前先落盘", () => {
    const code = stripComments(source)
    expect(code).toContain("isChapterPath(pathAtSave) ? CHAPTER_AUTOSAVE_INTERVAL_MS : OUTLINE_AUTOSAVE_DELAY_MS")
    expect(code).toContain("void flushNonChapterPendingSave(previousFile)")
    expect(code).toContain("void flushNonChapterPendingSave(currentFile)")
    const ingest = code.slice(code.indexOf("const handleIngestOutline"), code.indexOf("startOutlineIngestTask(project.path, selectedFile)"))
    expect(ingest).toContain("await runPendingChapterSave()")
  })

  /*
   * 大纲 HTML 就地编辑的落盘接线。
   *
   * 这条守的是「改完能存下来」这件事在**组件树上的最后一步**：
   * 双格式查看器把改好的 HTML 交出来（onSaveHtml），preview-panel 必须写到
   * **同名 .html**，而不是写回 .md —— 两格式独立是既定设计（MD 保存也不重建 HTML），
   * 写错文件会把人工改的档案写进正文编辑器那份 MD 里。
   */
  it("大纲 HTML 就地编辑写回同名 .html，且两处双格式入口都接上", () => {
    const code = stripComments(source)
    expect(code).toContain('return target.replace(/\\.md$/i, ".html")')
    const save = code.slice(code.indexOf("const saveCompanionHtml"), code.indexOf("const syncDiskBeforeAction"))
    expect(save).toContain("await writeFileAtomic(path, html)")
    expect(save).toContain("setCompanionHtml(html)")
    // 双格式查看器出现两处（UI 测试版编辑器和普通预览分支），都要传保存回调
    expect(code.match(/onSaveHtml=\{saveCompanionHtml\}/g) ?? []).toHaveLength(2)
  })
})

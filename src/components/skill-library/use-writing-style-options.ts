import { useEffect, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { loadWritingStyleStore } from "@/lib/novel/writing-style-store"

/**
 * 文风预设投影成选择器可用的条目（丁-2）。
 *
 * ⚠️ 与 `useDeAiSkillOptions` 同形的**独立一份**，不是复用它的状态：
 * 文风预设没有 `description` / `kind` / `tags`（见
 * `unified-skill-library-view.tsx:224` 的说明），硬塞进 DeAi 的形状只会两头别扭。
 */
export interface WritingStyleOption {
  id: string
  name: string
  /** 副标题：这条文风来自哪本书。 */
  description: string
}

interface UseWritingStyleOptionsParams {
  projectPath?: string | null
  /**
   * 本次生成的选择（三态，语义见 `writing-style-store.ts` 的
   * `BuildWritingStyleContextOptions.styleIdOverride`）：
   * - `undefined` = 没有覆盖，**当前**应显示项目启用项；
   * - `null` = 显式「本次不用文风」；
   * - `string` = 选中的预设 id。
   */
  selectedSkillId?: string | null
}

interface WritingStyleOptionsState {
  loading: boolean
  styles: WritingStyleOption[]
  effectiveName: string
  currentSkillId: string | null
  defaultSkillId: string | null
  /** `loadWritingStyleStore` 内部捕获所有失败并返回空 store，所以这里目前恒为 ""。 */
  loadError: string
}

/**
 * 「所选预设已不存在」时的显示名。
 *
 * 这个状态是**真实可达**的：用户在面板里选了某条文风，随后在文风库里把它删掉。
 * 生成侧对未知 id 的取值是「本次没有可用文风」（渲染成 `""`，见
 * `resolveWritingStylePreset`），所以这里必须**显式说出来**，
 * 而不是回落到项目启用项的名字 —— 那会让界面显示的和实际注入的不是同一条。
 */
const MISSING_STYLE_NAME = "所选文风已不存在"

export function useWritingStyleOptions({
  projectPath,
  selectedSkillId,
}: UseWritingStyleOptionsParams): WritingStyleOptionsState {
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [state, setState] = useState<WritingStyleOptionsState>({
    loading: true,
    styles: [],
    effectiveName: "未启用",
    currentSkillId: null,
    defaultSkillId: null,
    loadError: "",
  })

  useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, loading: true, loadError: "" }))
    /*
     * `loadWritingStyleStore(projectPath: string)` 不接受 undefined，且它自己
     * 吞掉所有读盘失败（返回空 store），所以这里不需要 catch：
     * 没有项目时直接给一份空状态，与「项目里还没提炼过文风」表现一致。
     */
    if (!projectPath) {
      setState({
        loading: false,
        styles: [],
        effectiveName: "未启用",
        currentSkillId: null,
        defaultSkillId: null,
        loadError: "",
      })
      return
    }
    loadWritingStyleStore(projectPath)
      .then((store) => {
        if (cancelled) return
        const styles: WritingStyleOption[] = store.styles.map((preset) => ({
          id: preset.id,
          name: preset.name,
          description: `来源：${preset.sourceBook}`,
        }))
        const defaultSkillId = store.enabledStyleId && styles.some((s) => s.id === store.enabledStyleId)
          ? store.enabledStyleId
          : null
        const pickedId = typeof selectedSkillId === "string" ? selectedSkillId : undefined
        const pickedExists = pickedId !== undefined && styles.some((s) => s.id === pickedId)
        const currentSkillId = selectedSkillId === null
          // 显式「本次不用」：**没有任何**选项是当前项（连项目启用项也不是）
          ? null
          : pickedId !== undefined
            // 选中的 id 哪怕已不在库里也照样报出去：界面据此说「已不存在」，
            // 而不是悄悄显示成项目启用项（生成侧对未知 id 是「不用文风」）。
            ? pickedId
            : defaultSkillId
        const effectiveName = selectedSkillId === null
          ? "本次不用"
          : pickedId !== undefined
            ? (pickedExists ? styles.find((s) => s.id === pickedId)!.name : MISSING_STYLE_NAME)
            : (styles.find((s) => s.id === defaultSkillId)?.name ?? "未启用")
        setState({
          loading: false,
          styles,
          effectiveName,
          currentSkillId,
          defaultSkillId,
          loadError: "",
        })
      })
      .catch(() => {
        if (cancelled) return
        setState({
          loading: false,
          styles: [],
          effectiveName: "未启用",
          currentSkillId: null,
          defaultSkillId: null,
          loadError: "",
        })
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, projectPath, selectedSkillId])

  return state
}

/**
 * 丁-4：把项目里的**角色灵魂**（`CharacterAura`）投影成两个 UI 用途：
 *
 * 1. 引用弹窗「角色灵魂」子 tab 的条目来源（`souls`）；
 * 2. 发送前的**确认步骤**（`requestSoulBindingTarget` + `soulBindingDialog`）——
 *    把「问用户绑给谁」做成一个可以 `await` 的请求，形状与
 *    `chat-panel.tsx` 里 `requestChapterPlanConfirm`（`resolverRef` + state）一致。
 *
 * ⚠️ 这里**只读**：`listCharacterAuras` 读 `.qmai/character-aura.json`，
 * 写盘一律由 `message-scoped-soul-binding.ts` 在用户确认之后做。
 * 所以「打开了弹窗又取消」不会在项目里留下任何痕迹。
 *
 * ⚠️ 术语：本模块的「灵魂」是**角色灵魂**，不是作品灵魂
 * （`contextPack.soulDoc`）。两者同名不同物，别混。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listCharacterAuras, type CharacterAura } from "@/lib/novel/character-aura"
import { SoulBindingTargetDialog } from "./soul-binding-target-dialog"

export interface CharacterSoulOption {
  id: string
  name: string
  /** 副标题：来源（内置 / 自定义）+ 灵魂分类。 */
  description: string
  builtIn: boolean
  /**
   * 带 `portablePersonality` ⇒ 人格规则是 fail-closed 的：
   * 预算装不下时生成会停机（见 `describePortablePersonalityRisk`）。
   */
  hasPortablePersonality: boolean
}

export interface CharacterSoulReference {
  souls: CharacterSoulOption[]
  /**
   * 打开确认弹窗并等用户选一个小说人物。
   * 返回 `null` = 用户取消（调用方**必须**据此中止发送，不要用默认值代替）。
   */
  requestSoulBindingTarget: (auraId: string) => Promise<string | null>
  /** 挂到面板 JSX 里的确认弹窗。 */
  soulBindingDialog: ReactNode
}

function toOption(aura: CharacterAura): CharacterSoulOption {
  const source = aura.builtIn ? "内置灵魂" : "自定义灵魂"
  const category = aura.category?.trim()
  return {
    id: aura.id,
    name: aura.name,
    description: category ? `${source} · ${category}` : source,
    builtIn: Boolean(aura.builtIn),
    hasPortablePersonality: aura.portablePersonality !== undefined,
  }
}

export function useCharacterSoulReference({
  projectPath,
}: {
  projectPath?: string | null
}): CharacterSoulReference {
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [auras, setAuras] = useState<CharacterAura[]>([])
  const [pendingAuraId, setPendingAuraId] = useState<string | null>(null)
  const resolverRef = useRef<((characterName: string | null) => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!projectPath) {
      setAuras([])
      return
    }
    // `listCharacterAuras` = 内置灵魂 + 读盘的自定义灵魂。它下面的
    // `loadCharacterAuraStore` 把「读不到 / JSON 坏了」都吞成空 store，
    // 所以**它今天不 reject**、列表至少含内置灵魂。这个 `.catch` 是**结构性防御**：
    // 真 reject 时退化成空列表（而不是把拒绝抛出去变成未处理 rejection），
    // 那时灵魂 tab 会显示空 —— 这是一条**降级**，不是「只有内置灵魂」。
    listCharacterAuras(projectPath)
      .then((loaded) => {
        if (!cancelled) setAuras(loaded)
      })
      .catch(() => {
        if (!cancelled) setAuras([])
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, projectPath])

  const souls = useMemo(() => auras.map(toOption), [auras])

  const settle = useCallback((characterName: string | null) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setPendingAuraId(null)
    resolve?.(characterName)
  }, [])

  const requestSoulBindingTarget = useCallback((auraId: string) => {
    return new Promise<string | null>((resolve) => {
      // 理论上不会有两个请求同时挂着（`handleSend` 一次只问一次），
      // 但真出现时必须先把上一个解掉，否则那个 `await` 会永远悬着。
      resolverRef.current?.(null)
      resolverRef.current = resolve
      setPendingAuraId(auraId)
    })
  }, [])

  // 面板卸载时把悬着的请求解成「取消」，避免调用方的 await 永久挂起。
  useEffect(() => () => {
    const resolve = resolverRef.current
    resolverRef.current = null
    resolve?.(null)
  }, [])

  const pendingAura = pendingAuraId ? auras.find((aura) => aura.id === pendingAuraId) : undefined

  const soulBindingDialog = (
    <SoulBindingTargetDialog
      open={pendingAuraId !== null}
      projectPath={projectPath ?? ""}
      soulName={pendingAura?.name ?? ""}
      soulHasPortablePersonality={pendingAura?.portablePersonality !== undefined}
      onOpenChange={(next) => {
        if (!next) settle(null)
      }}
      onConfirm={(characterName) => settle(characterName)}
    />
  )

  return { souls, requestSoulBindingTarget, soulBindingDialog }
}

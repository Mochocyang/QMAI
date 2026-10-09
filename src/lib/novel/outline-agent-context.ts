import type { ContextPack } from "./context-engine"
import type { OutlineSubAgentKind } from "./outline-multi-agent-orchestrator"

function section(title: string, value: string): string {
  return value.trim() ? `## ${title}\n${value.trim()}` : ""
}

function clampContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const marker = "\n\n[局部上下文已压缩]\n\n"
  if (maxChars <= marker.length) return value.slice(0, maxChars)
  const available = maxChars - marker.length
  const head = Math.ceil(available * 0.65)
  return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`
}

export function buildScopedOutlineSubAgentContext(
  pack: ContextPack,
  kind: OutlineSubAgentKind,
  maxChars = 8_000,
): string {
  const common = [
    section("本轮任务", pack.task),
    section("作品灵魂", pack.soulDoc),
    // 同人正典进公共段：所有子 Agent 都必须受原作既成事实约束。
    section("原作正典", pack.sourceCanon ?? ""),
    section("主线大纲", pack.outline),
  ]
  const specific: Record<OutlineSubAgentKind, string[]> = {
    outline: [
      section("最近摘要", pack.recentSummaries.slice(-3).join("\n")),
      section("世界硬规则", pack.canonRules),
      section("伏笔状态", pack.foreshadowingStates),
    ],
    topic: [
      section("核心设定", pack.relatedSettings),
      section("世界硬规则", pack.canonRules),
      section("故事时间线", pack.timeline),
    ],
    character: [
      section("角色当前状态", pack.characterStates),
      section("角色认知", pack.cognitionStates),
      section("角色气质", pack.characterAuras),
      section("最近摘要", pack.recentSummaries.slice(-3).join("\n")),
    ],
    setting: [
      section("核心设定", pack.relatedSettings),
      section("世界硬规则", pack.canonRules),
      section("故事时间线", pack.timeline),
    ],
    foreshadowing: [
      section("伏笔状态", pack.foreshadowingStates),
      section("故事时间线", pack.timeline),
      section("最近摘要", pack.recentSummaries.slice(-3).join("\n")),
      section("必须避免", pack.mustAvoid),
    ],
  }
  return clampContext([...common, ...specific[kind]].filter(Boolean).join("\n\n"), Math.max(0, maxChars))
}

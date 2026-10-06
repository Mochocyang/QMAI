import { STYLE_FACETS } from "@/lib/novel/book-analysis/style-fingerprint"
import type { WorkbenchEvidence, WorkbenchItem } from "@/lib/novel/book-analysis/workbench-core"
import type { StyleMetrics } from "@/lib/novel/book-analysis/style-metrics"

export function WorkbenchStyleDetails({ item, evidence, metrics }: {
  item: WorkbenchItem; evidence: WorkbenchEvidence[]; metrics?: StyleMetrics
}) {
  const profile = item.styleFingerprint
  if (!profile) return null
  const sources = (ids: string[]) => <details><summary>原文依据（{ids.length}）</summary>
    {evidence.filter((e) => ids.includes(e.id)).map((e) => <blockquote className="wb-evidence" key={e.id}><small>第{e.order}章 · {e.id} · 正文位置{e.start}～{e.end}</small><p>{e.text}</p></blockquote>)}
  </details>
  return <div className="wb-style-profile">
    {!!profile.omitted?.length && <details><summary>未采纳的候选（{profile.omitted.length}项）</summary>
      <p className="wb-muted">以下为模型核验意见，仅作修订记录。这些建议未作为写作约束，保留内容仍需人工确认。</p>
      {profile.omitted.map((entry, index) => <div className="wb-style-word" key={`${entry.kind}:${entry.label}:${index}`}><strong>{entry.label}</strong><p>{entry.reason}</p></div>)}
    </details>}
    <h3>文风画像覆盖</h3>
    <div className="wb-style-coverage">{profile.coverage.map((c) => <div key={c.dimension}>
      <strong>{STYLE_FACETS[c.dimension]}</strong><span className="wb-muted">{c.status === "observed" ? "有依据" : "样本不足"}</span><p>{c.reason}</p>
    </div>)}</div>
    <h3>用词与搭配</h3>
    <p className="wb-muted">次数按已编号证据片段逐字计数，不代表全书词频，也不是新作必须重复的配额。</p>
    {profile.lexicon.length ? profile.lexicon.map((word) => <div className="wb-style-word" key={word.word}>
      <div className="wb-row"><strong>{word.word}</strong><span className="wb-muted">{word.count}次 · {word.chapterCount}章 · {word.kind === "expression" ? "可参考表达" : "原作专用，仅作观察"}</span></div>
      <p>{word.usage}</p>{sources(word.evidenceIds)}
    </div>) : <p className="wb-muted">没有足够依据确认词汇偏好。</p>}
    {profile.scenes.length > 0 && <><h3>不同场景的写法</h3>{profile.scenes.map((scene, i) => <div className="wb-style-word" key={`${scene.scene}:${i}`}><strong>{scene.scene}</strong><p>{scene.guidance}</p>{sources(scene.evidenceIds)}</div>)}</>}
    {metrics && <details><summary>程序统计与高频观察</summary>
      <p>样本{metrics.counts.chars.toLocaleString()}字 · 平均句长{metrics.derived.avgSentenceChars}字 · 平均段长{metrics.derived.avgParagraphChars}字 · 含对白段落{(metrics.derived.dialogueParagraphRatio * 100).toFixed(1)}%</p>
      <p>高频实词：{metrics.topWords.map((w) => `${w.word}（${w.count}）`).join("、") || "无"}</p>
      <p>句首词：{metrics.topSentenceOpeners.map((w) => `${w.word}（${w.count}）`).join("、") || "无"}</p>
      <p className="wb-muted">统计可能包含人名与题材词，需要结合原文解释。{!metrics.segmenterAvailable && "当前分词能力受限，词频为相邻汉字窗口近似值。"}</p>
    </details>}
  </div>
}

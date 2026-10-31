/**
 * 候选角色的「轻量预览卡」（方案 C2）。
 *
 * 候选没有档案，中栏以前只能退回列表 —— 用户点了等于没反应。
 * 这里给出一张只读卡：出场分布 + 每章提到他的原句 + 推测定位，
 * 底部两个动作（建档 / 删除）与左栏右键菜单等价。
 *
 * 原句来自 `loadSightingExcerpts`（首次 1 章 + 最近 2 章，最多读 3 个文件）。
 */
import { useCallback, useEffect, useState } from "react"
import {
  loadSightingExcerpts,
  type SightingExcerpt,
} from "@/lib/novel/persona-sighting-preview"
import type { PersonaSkillSighting } from "@/lib/novel/persona-skill-types"

export interface PersonaCandidatePreviewProps {
  projectPath?: string
  sighting: PersonaSkillSighting
  busy: boolean
  /** 建档 / 删除的结果文案。以前不显示，导致「点了没反应」。 */
  message?: string
  onPromote: () => void
  onDelete: () => void
}

/**
 * 出场 20 次以上、且章节跨度很大时，「待观察」这类角色多半是背景。
 * 这里只做一句人话提示，不作为任何自动决策的依据。
 */
function describeGuess(sighting: PersonaSkillSighting): string {
  const span = sighting.lastChapter - sighting.firstChapter
  if (sighting.appearanceCount === 1) {
    return "只出场一次，更像场景人物（路人）。建档后建议按「次要人物」处理，或直接删除。"
  }
  if (sighting.appearanceCount >= 4 && span >= 8) {
    return "出场次数多、跨度也大，可能是被反复提到的关键配角，值得建档。"
  }
  return "出场集中在一小段章节里，更像阶段性人物。可按「次要人物」建档。"
}

export function PersonaCandidatePreview(props: PersonaCandidatePreviewProps) {
  const { projectPath, sighting } = props
  const [excerpts, setExcerpts] = useState<SightingExcerpt[] | null>(null)

  const load = useCallback(async () => {
    if (!projectPath) {
      setExcerpts([])
      return
    }
    setExcerpts(null)
    const result = await loadSightingExcerpts({
      projectPath,
      names: [sighting.characterName, ...sighting.aliases],
      chapters: sighting.chapters,
    })
    setExcerpts(result)
  }, [projectPath, sighting])

  useEffect(() => {
    void load()
  }, [load])

  const loading = excerpts === null

  return (
    <div className="ui-test-cand" data-testid="persona-candidate-preview">
      <header className="ui-test-cand-head">
        <div>
          <h3>{sighting.characterName}</h3>
          <p className="ui-test-cand-sub">
            候选角色 · 还没有档案
            {sighting.aliases.length > 0 ? ` · 别名：${sighting.aliases.join("、")}` : ""}
          </p>
        </div>
        <div className="ui-test-cand-actions">
          <button
            type="button"
            className="ui-test-skills-action is-danger"
            data-testid="persona-candidate-delete"
            onClick={props.onDelete}
            disabled={props.busy}
          >
            删除候选
          </button>
          <button
            type="button"
            className="ui-test-skills-action is-primary"
            data-testid="persona-candidate-promote"
            onClick={props.onPromote}
            disabled={props.busy}
          >
            建档
          </button>
        </div>
        {props.message ? (
          <p className="ui-test-cand-message" data-testid="persona-candidate-message">
            {props.message}
          </p>
        ) : null}
      </header>

      <section className="ui-test-cand-card">
        <h5>出场分布</h5>
        <dl className="ui-test-cand-kv">
          <div>
            <dt>共出场</dt>
            <dd>{sighting.appearanceCount} 次</dd>
          </div>
          <div>
            <dt>首次出场</dt>
            <dd>第 {sighting.firstChapter} 章</dd>
          </div>
          <div>
            <dt>最近出场</dt>
            <dd>第 {sighting.lastChapter} 章</dd>
          </div>
          <div>
            <dt>出场章节</dt>
            <dd>{sighting.chapters.length > 0 ? sighting.chapters.join("、") : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="ui-test-cand-card">
        <h5>每章提到他的原句</h5>
        {loading ? (
          <p className="ui-test-cand-hint">正在读取章节…</p>
        ) : excerpts.length === 0 ? (
          <p className="ui-test-cand-hint">没有在正文里找到提及他的句子。</p>
        ) : (
          excerpts.map((item) => (
            <div key={item.chapter} className="ui-test-cand-quote">
              <span className="ch">第 {item.chapter} 章</span>
              {item.sentences.map((sentence, index) => (
                <p key={index}>{sentence}</p>
              ))}
            </div>
          ))
        )}
      </section>

      <section className="ui-test-cand-card">
        <h5>推测</h5>
        <p className="ui-test-cand-hint">{describeGuess(sighting)}</p>
        <p className="ui-test-cand-hint" style={{ marginTop: 8 }}>
          候选只统计出场，没有可编辑内容。建档后会移到「活跃角色」，并生成一份空白档案；
          内容由你补，或等下一次「提取记忆」自动补齐。
        </p>
      </section>
    </div>
  )
}

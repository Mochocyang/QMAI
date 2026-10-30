import { useMemo, useState, type ReactElement } from "react"

import { buildLineDiff, summarizeDiff } from "@/lib/novel/version-diff"
import type { VersionEntry } from "@/lib/novel/version-store"

import "./version-history.css"

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * 把版本时间格式化成「2026-10-26 09:00（5 分钟前）」。
 *
 * 时间一律取 `version.at`（由版本文件名里的时间戳反解而来），**绝不能用文件 mtime**：
 * mtime 会被复制、云同步、解压、备份还原改掉，一个两年前的版本拷到新电脑上
 * mtime 会变成刚拷贝的时刻，界面上就会把最老的版本显示成「刚刚」，
 * 用户按这个顺序做选择会直接选错。文件名里的时间戳是我们写入时自己决定的，只有它可信。
 *
 * `now` 显式可传，便于测试固定「现在」而不必去 mock 全局时间。
 */
export function formatVersionTime(at: Date, now: Date = new Date()): string {
  const stamp = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`

  // 未来时间（系统时钟被回调过、或用户手工导入）统一说「刚刚」，
  // 否则会算出「-3 分钟前」这种读不通的话。
  const elapsed = Math.max(0, now.getTime() - at.getTime())

  let relative: string
  if (elapsed < MINUTE_MS) {
    relative = "刚刚"
  } else if (elapsed < HOUR_MS) {
    relative = `${Math.floor(elapsed / MINUTE_MS)} 分钟前`
  } else if (elapsed < DAY_MS) {
    relative = `${Math.floor(elapsed / HOUR_MS)} 小时前`
  } else {
    relative = `${Math.floor(elapsed / DAY_MS)} 天前`
  }

  return `${stamp}（${relative}）`
}

export interface VersionHistoryDialogProps {
  /** 被查看对象的标题，用于「<标题> · 历史版本」。 */
  title: string
  /** 编辑器里的当前内容，作为差异比较的右侧。 */
  currentContent: string
  /** 历史版本列表，约定按时间倒序（最新在前）。 */
  versions: VersionEntry[]
  onClose: () => void
  onRestore: (version: VersionEntry) => void
}

/**
 * 历史版本弹窗。
 *
 * 这里是自绘的 fixed 遮罩，没有复用 `@/components/ui/dialog`：那个是基于 base-ui 的
 * 受控组件，自带 open 状态机、焦点陷阱和关闭行为，而我们只需要「弹出来 + 自己处理
 * 遮罩点击策略」，套一层反而要为绕开它的状态机写一堆补丁。
 *
 * 布局上刻意分三段（head / body / actions），头部和底部 `flex: 0 0 auto`、
 * 中间 `flex: 1 1 auto; min-height: 0`，且**只有差异区自己滚动**：
 * 之前把整块内容放进一个滚动容器，版本一多列表就把底部的按钮顶到可视区外面，
 * 用户找不到「恢复」按钮。现在无论历史有多少条，底部按钮都固定在面板底部。
 */
export function VersionHistoryDialog({
  title,
  currentContent,
  versions,
  onClose,
  onRestore,
}: VersionHistoryDialogProps): ReactElement {
  // 用 path 而不是整个 entry 做选中态：entry 是每次渲染都可能重建的新对象，
  // 存对象会让依赖比较失效；path 在同一个版本库里唯一且稳定。
  const [selectedPath, setSelectedPath] = useState<string | null>(versions[0]?.path ?? null)

  const selected = useMemo(
    () => versions.find((version) => version.path === selectedPath) ?? versions[0] ?? null,
    [versions, selectedPath],
  )

  const diff = useMemo(
    () => (selected ? buildLineDiff(selected.content, currentContent) : []),
    [selected, currentContent],
  )

  const summary = useMemo(() => summarizeDiff(diff), [diff])
  const unchanged = summary.added === 0 && summary.removed === 0

  return (
    <div className="version-history-overlay">
      {/* 点遮罩不关闭：用户可能只是想点空白处取消选中，误关会让已经翻到的
          版本位置丢失，得重新滚一遍。关闭只走右上 × 和底部「关闭」。 */}
      <div
        className="version-history-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} · 历史版本`}
      >
        <div className="version-history-head">
          <div>
            <h3>{`${title} · 历史版本`}</h3>
            <p>每次保存前自动留一份，保留最近 50 个 / 90 天。</p>
          </div>
          <button type="button" className="version-history-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {versions.length === 0 ? (
          <p className="version-history-empty">还没有历史版本。改一次内容并保存，这里就会出现第一条。</p>
        ) : (
          <div className="version-history-body">
            <ul className="version-history-list">
              {versions.map((version) => (
                <li key={version.path}>
                  <button
                    type="button"
                    data-version-item
                    data-active={version.path === selected?.path}
                    onClick={() => setSelectedPath(version.path)}
                  >
                    <span className="version-history-time">{formatVersionTime(version.at)}</span>
                    <span className="version-history-size">{`${version.content.length} 字`}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="version-history-diff">
              <p className="version-history-summary">
                {unchanged
                  ? "与当前版本一致"
                  : `相比当前版本：新增 ${summary.added} 行，删除 ${summary.removed} 行`}
              </p>
              <div className="version-history-lines">
                {diff.map((line, index) => (
                  <div
                    // 差异行会重复（空白行、相同段落），index 才是唯一稳定的键。
                    key={index}
                    className="version-history-line"
                    data-kind={line.kind}
                  >
                    <span className="version-history-gutter">
                      {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
                    </span>
                    <span className="version-history-text">{line.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="version-history-actions">
          <button type="button" className="version-history-secondary" onClick={onClose}>
            关闭
          </button>
          {/* 无差异时不显示恢复：回退到一模一样的内容毫无意义，
              还得多跑一次写盘 + 生成一条新历史。 */}
          {selected && !unchanged ? (
            <button
              type="button"
              className="version-history-primary"
              title="当前内容会先被存成一条历史，所以恢复也能撤销"
              onClick={() => onRestore(selected)}
            >
              恢复这个版本
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

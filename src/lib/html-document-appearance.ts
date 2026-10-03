import { useEffect, useMemo, useState } from "react"
import { readUiTestSkin, type UiTestSkin } from "@/lib/ui-test"

/** 预览注入样式的唯一标记。重复套用时替换这一段，不叠样式。 */
export const DOCUMENT_APPEARANCE_STYLE_ID = "qmai-document-appearance"

function appearanceStylePattern(): RegExp {
  return new RegExp(
    `<style id="${DOCUMENT_APPEARANCE_STYLE_ID}">[\\s\\S]*?<\\/style>`,
    "gi",
  )
}

interface DocumentPalette {
  scheme: "light" | "dark"
  bg: string
  surface: string
  surface2: string
  ink: string
  ink2: string
  muted: string
  border: string
  brand: string
  brandSoft: string
  brandSoft2: string
  brandText: string
  onBrand: string
  qi: string
  cheng: string
  zhuan: string
  he: string
  ok: string
  okSoft: string
  okBorder: string
  warn: string
  warnSoft: string
  danger: string
  dangerSoft: string
  dangerBorder: string
  day: string
  kQiBg: string
  kQiInk: string
  kChengBg: string
  kChengInk: string
  kHeBg: string
  kHeInk: string
  beatFlatBg: string
  beatFlatBorder: string
  beatFlatInk: string
  beatRiseBg: string
  beatRiseBorder: string
  beatRiseInk: string
  beatTightBg: string
  beatTightBorder: string
  beatTightInk: string
  beatFallBg: string
  beatFallBorder: string
  beatFallInk: string
  beatHangBg: string
  beatHangInk: string
}

/** 与外观皮肤的纸底、墨色、强调色对齐。节拍色单独给星夜压暗，避免奶油色块贴在夜色页面上。 */
const PALETTES: Record<UiTestSkin, DocumentPalette> = {
  jing: {
    scheme: "light",
    bg: "#fcfdfb",
    surface: "#f2f5ef",
    surface2: "#e4ece3",
    ink: "#273c35",
    ink2: "#3e5248",
    muted: "#5d6e64",
    border: "#dfe6da",
    brand: "#45624f",
    brandSoft: "#edf3ec",
    brandSoft2: "#dce9da",
    brandText: "#384f3e",
    onBrand: "#ffffff",
    qi: "#5d6e64",
    cheng: "#6f9b6a",
    zhuan: "#45624f",
    he: "#aa8c5b",
    ok: "#2f6a45",
    okSoft: "#e5f2e8",
    okBorder: "#b7d4c0",
    warn: "#8a6230",
    warnSoft: "#f6efe3",
    danger: "#943f36",
    dangerSoft: "#f8ebe9",
    dangerBorder: "#e7c4bf",
    day: "#6f9b6a",
    kQiBg: "#e4ece3",
    kQiInk: "#3e5248",
    kChengBg: "#edf3ec",
    kChengInk: "#384f3e",
    kHeBg: "#f3ebdf",
    kHeInk: "#655a42",
    beatFlatBg: "#e4ece3",
    beatFlatBorder: "#dfe6da",
    beatFlatInk: "#3e5248",
    beatRiseBg: "#edf3ec",
    beatRiseBorder: "#bed5ba",
    beatRiseInk: "#384f3e",
    beatTightBg: "#dce9da",
    beatTightBorder: "#96ba91",
    beatTightInk: "#2c3e33",
    beatFallBg: "#f2f5ef",
    beatFallBorder: "#dfe6da",
    beatFallInk: "#5d6e64",
    beatHangBg: "#f3ebdf",
    beatHangInk: "#655a42",
  },
  zhi: {
    scheme: "light",
    bg: "#fffcf7",
    surface: "#f5f0e5",
    surface2: "#ece4d3",
    ink: "#423d31",
    ink2: "#5a5346",
    muted: "#716b5b",
    border: "#e7decb",
    brand: "#655a42",
    brandSoft: "#f5f0e6",
    brandSoft2: "#ece2cf",
    brandText: "#54452f",
    onBrand: "#ffffff",
    qi: "#8e6e63",
    cheng: "#c4846a",
    zhuan: "#655a42",
    he: "#c49a3c",
    ok: "#3c7a3c",
    okSoft: "#eef7ee",
    okBorder: "#b7dfb7",
    warn: "#96601a",
    warnSoft: "#fff7e6",
    danger: "#a8071a",
    dangerSoft: "#fff1f0",
    dangerBorder: "#ffccc7",
    day: "#7a8f6a",
    kQiBg: "#f1ede9",
    kQiInk: "#5f4a3e",
    kChengBg: "#fbede6",
    kChengInk: "#a8451c",
    kHeBg: "#fef3e2",
    kHeInk: "#96601a",
    beatFlatBg: "#f4eee8",
    beatFlatBorder: "#e2d8cf",
    beatFlatInk: "#5f4a3e",
    beatRiseBg: "#fbede6",
    beatRiseBorder: "#f0cdb8",
    beatRiseInk: "#a8451c",
    beatTightBg: "#f6e0d2",
    beatTightBorder: "#e0a87e",
    beatTightInk: "#8a3f13",
    beatFallBg: "#efeae6",
    beatFallBorder: "#d8ccc2",
    beatFallInk: "#6b5548",
    beatHangBg: "#fff7e6",
    beatHangInk: "#96601a",
  },
  xing: {
    scheme: "dark",
    bg: "#222f2a",
    surface: "#1d2724",
    surface2: "#34483b",
    ink: "#e6eee7",
    ink2: "#c5d4cb",
    muted: "#adbcb2",
    border: "#334540",
    brand: "#b0c9ae",
    brandSoft: "#1e2921",
    brandSoft2: "#304434",
    brandText: "#d9e7d7",
    onBrand: "#17281d",
    qi: "#adbcb2",
    cheng: "#7ba37e",
    zhuan: "#b0c9ae",
    he: "#d4b483",
    ok: "#9dcead",
    okSoft: "#24382c",
    okBorder: "#3e6b4c",
    warn: "#e2c48a",
    warnSoft: "#3b362c",
    danger: "#efb3a7",
    dangerSoft: "#3a2a28",
    dangerBorder: "#7a4e48",
    day: "#8fb59a",
    kQiBg: "#2a3832",
    kQiInk: "#c5d4cb",
    kChengBg: "#24382c",
    kChengInk: "#c2d6c0",
    kHeBg: "#3b362c",
    kHeInk: "#e2c48a",
    beatFlatBg: "#2a3832",
    beatFlatBorder: "#334540",
    beatFlatInk: "#c5d4cb",
    beatRiseBg: "#24382c",
    beatRiseBorder: "#44604a",
    beatRiseInk: "#c2d6c0",
    beatTightBg: "#304434",
    beatTightBorder: "#5f8663",
    beatTightInk: "#d9e7d7",
    beatFallBg: "#1d2724",
    beatFallBorder: "#334540",
    beatFallInk: "#adbcb2",
    beatHangBg: "#3b362c",
    beatHangInk: "#e2c48a",
  },
}

function isSkin(value: unknown): value is UiTestSkin {
  return value === "jing" || value === "zhi" || value === "xing"
}

function paletteBlock(palette: DocumentPalette): string {
  return [
    `:root{color-scheme:${palette.scheme}`,
    `--bg:${palette.bg};--surface:${palette.surface};--surface2:${palette.surface2}`,
    `--ink:${palette.ink};--ink2:${palette.ink2};--muted:${palette.muted};--border:${palette.border}`,
    `--brand:${palette.brand};--brand-soft:${palette.brandSoft};--brand-soft2:${palette.brandSoft2}`,
    `--brand-text:${palette.brandText};--on-brand:${palette.onBrand}`,
    `--qi:${palette.qi};--cheng:${palette.cheng};--zhuan:${palette.zhuan};--he:${palette.he}`,
    `--ok:${palette.ok};--ok-soft:${palette.okSoft};--ok-border:${palette.okBorder}`,
    `--warn:${palette.warn};--warn-soft:${palette.warnSoft}`,
    `--danger:${palette.danger};--danger-soft:${palette.dangerSoft};--danger-border:${palette.dangerBorder}`,
    `--day:${palette.day}`,
    `--k-qi-bg:${palette.kQiBg};--k-qi-ink:${palette.kQiInk}`,
    `--k-cheng-bg:${palette.kChengBg};--k-cheng-ink:${palette.kChengInk}`,
    `--k-he-bg:${palette.kHeBg};--k-he-ink:${palette.kHeInk}`,
    `--beat-flat-bg:${palette.beatFlatBg};--beat-flat-border:${palette.beatFlatBorder};--beat-flat-ink:${palette.beatFlatInk}`,
    `--beat-rise-bg:${palette.beatRiseBg};--beat-rise-border:${palette.beatRiseBorder};--beat-rise-ink:${palette.beatRiseInk}`,
    `--beat-tight-bg:${palette.beatTightBg};--beat-tight-border:${palette.beatTightBorder};--beat-tight-ink:${palette.beatTightInk}`,
    `--beat-fall-bg:${palette.beatFallBg};--beat-fall-border:${palette.beatFallBorder};--beat-fall-ink:${palette.beatFallInk}`,
    `--beat-hang-bg:${palette.beatHangBg};--beat-hang-ink:${palette.beatHangInk}}`,
  ].join(";")
}

/** 盖住旧文档里写死的白底和浅色正文。节拍选择器比 .bt 更具体，放在后面。 */
const SURFACE_OVERRIDES = [
  "html,body{background:var(--bg);color:var(--ink)}",
  // 🔴 此处刻意不含 .chip：章纲/卷纲/通用卡片流的芯片本就是 var(--bg)（注入对它们是幂等的），
  // 而档案卡（角色卡/势力卡/体系卡…）的芯片在深色头图上是白字，注入白底会变成「白底白字」。
  ".tree,.panel,.nav,.story-card,details.cc,.bt{background:var(--bg);border-color:var(--border)}",
  ".chapter{background:var(--surface);border-color:var(--border);color:var(--ink)}",
  ".branch{background:var(--surface2);border-top-color:var(--border);border-right-color:var(--border);border-bottom-color:var(--border);color:var(--ink)}",
  ".mainline,.chapter-order{color:var(--brand)}",
  ".map-header{border-left-color:var(--brand)}",
  // 同 .chip：此处刻意不含 .empty——章纲/卷纲用的是 `.panel .empty`（特异性更高，注入本就无效），
  // 只有档案卡的裸 `.empty` 会被染成灰色，丢掉琥珀警示色。
  ".meta,.chapter-count,footer,.main-summary,.chapter-summary,.chapter .beats,.chars,.section-title,.branch-trigger{color:var(--muted)}",
  ".chapter-title,.event-label,.branch-label{color:var(--ink)}",
  ".spinoff{color:var(--warn)}",
  ".chapter-body{border-top-color:var(--border)}",
  ".event{border-left-color:var(--border)}",
  ".k-root,.who .lb,.lrow .lb,.revgrid .sg,.role-hero,.navlink b,.pace .sg,.cno{color:var(--on-brand)}",
  "svg .cp{stroke:var(--bg)}",
  ".k-qi,.tag.mood{background:var(--k-qi-bg);color:var(--k-qi-ink)}",
  ".k-cheng{background:var(--k-cheng-bg);color:var(--k-cheng-ink)}",
  ".k-he{background:var(--k-he-bg);color:var(--k-he-ink)}",
  '.bt[data-b="平"],.bt[data-b="缓"]{background:var(--beat-flat-bg);border-color:var(--beat-flat-border);color:var(--beat-flat-ink)}',
  '.bt[data-b="升"],.bt[data-b="起"]{background:var(--beat-rise-bg);border-color:var(--beat-rise-border);color:var(--beat-rise-ink)}',
  '.bt[data-b="紧"]{background:var(--beat-tight-bg);border-color:var(--beat-tight-border);color:var(--beat-tight-ink)}',
  '.bt[data-b="顶"]{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}',
  '.bt[data-b="落"]{background:var(--beat-fall-bg);border-color:var(--beat-fall-border);color:var(--beat-fall-ink)}',
  '.bt[data-b="悬"]{background:var(--beat-hang-bg);border-color:var(--he);color:var(--beat-hang-ink)}',
  ".tag.gift,.tag.pay,.role-lead,.st-ok,.panel .okbox{border-color:var(--ok-border)}",
  ".tag.warn,.role-block{border-color:var(--danger-border)}",
].join("")

function appearanceCss(skin: UiTestSkin): string {
  return `${paletteBlock(PALETTES[skin])}${SURFACE_OVERRIDES}`
}

export function readDocumentAppearance(): UiTestSkin {
  if (typeof document === "undefined") return "jing"
  const value = document.documentElement.dataset.uiTestSkin
  if (isSkin(value)) return value
  return readUiTestSkin()
}

export function subscribeDocumentAppearance(onChange: (skin: UiTestSkin) => void): () => void {
  if (typeof window === "undefined") return () => {}

  const onSkinChange = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    onChange(isSkin(detail) ? detail : readDocumentAppearance())
  }
  window.addEventListener("qmai-ui-test-skin-change", onSkinChange)

  const observer = new MutationObserver(() => onChange(readDocumentAppearance()))
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-ui-test-skin"],
  })

  return () => {
    window.removeEventListener("qmai-ui-test-skin-change", onSkinChange)
    observer.disconnect()
  }
}

/**
 * 把当前外观写进预览用的 HTML 副本。
 * 不修改入参；已有注入会被替换，避免切换皮肤时叠多段样式。
 */
export function applyDocumentAppearance(html: string, skin: UiTestSkin): string {
  const stripped = html.replace(appearanceStylePattern(), "")
  const block = `<style id="${DOCUMENT_APPEARANCE_STYLE_ID}">${appearanceCss(skin)}</style>`
  if (/<\/head>/i.test(stripped)) {
    return stripped.replace(/<\/head>/i, `${block}</head>`)
  }
  if (/<head[^>]*>/i.test(stripped)) {
    return stripped.replace(/<head[^>]*>/i, (open) => `${open}${block}`)
  }
  if (/<html[^>]*>/i.test(stripped)) {
    return stripped.replace(/<html[^>]*>/i, (open) => `${open}<head>${block}</head>`)
  }
  return `<head>${block}</head>${stripped}`
}

export function useDocumentAppearance(): UiTestSkin {
  const [skin, setSkin] = useState<UiTestSkin>(readDocumentAppearance)
  useEffect(() => subscribeDocumentAppearance(setSkin), [])
  return skin
}

/** 预览 iframe 用的 HTML。源码编辑和保存继续用原始字符串。 */
export function useDocumentAppearanceHtml(html: string): string {
  const skin = useDocumentAppearance()
  return useMemo(() => applyDocumentAppearance(html, skin), [html, skin])
}

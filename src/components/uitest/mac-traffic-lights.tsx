// Glyphs and colors from @arvinxu/macos-traffic-light (MIT, Copyright (c) 2020 Arvin Xu).
// Outer size is 14px under border-box: that package draws a 12px disc plus a 1px border.
// Centers are 23px apart, the macOS 26 window-button offset.

interface MacTrafficLightsProps {
  onClose: () => void
  onMinimize: () => void
  onZoom: () => void
}

export function MacTrafficLights({ onClose, onMinimize, onZoom }: MacTrafficLightsProps) {
  return (
    <div className="ui-test-win-actions ui-test-traffic">
      <button type="button" className="ui-test-traffic-btn ui-test-traffic-close" aria-label="关闭窗口" title="关闭窗口" onClick={onClose}>
        <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
          <path fill="currentColor" fillRule="evenodd" d="M0.157283 0.151369C0.365251 -0.0521572 0.70045 -0.050193 0.905971 0.155756L3 2.25414L5.09403 0.155756C5.29955 -0.050193 5.63475 -0.0521572 5.84272 0.151369C6.05069 0.354895 6.05267 0.686839 5.84715 0.892788L3.74431 3L5.84715 5.10721C6.05267 5.31316 6.05069 5.64511 5.84272 5.84863C5.63475 6.05216 5.29955 6.05019 5.09403 5.84424L3 3.74586L0.905971 5.84424C0.70045 6.05019 0.365251 6.05216 0.157283 5.84863C-0.0506851 5.64511 -0.0526685 5.31316 0.152853 5.10721L2.25569 3L0.152853 0.892788C-0.0526685 0.686839 -0.0506851 0.354895 0.157283 0.151369Z" />
        </svg>
      </button>
      <button type="button" className="ui-test-traffic-btn ui-test-traffic-min" aria-label="最小化" title="最小化" onClick={onMinimize}>
        <svg width="8" height="2" viewBox="0 0 8 2" aria-hidden="true">
          <path fill="currentColor" fillRule="evenodd" d="M8 2L0 2L0 0L8 0V2Z" />
        </svg>
      </button>
      <button type="button" className="ui-test-traffic-btn ui-test-traffic-zoom" aria-label="最大化或还原" title="最大化或还原" onClick={onZoom}>
        <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
          <path fill="currentColor" fillRule="evenodd" d="M1.45679 0.869873L5.16357 4.23975C5.48486 4.53174 6 4.30371 6 3.86963V0.5C6 0.223877 5.77612 0 5.5 0H1.79321C1.33618 0 1.11865 0.5625 1.45679 0.869873ZM0.853516 1.85352L4.14648 5.14648C4.46143 5.46143 4.23828 6 3.79297 6H0.5C0.223877 6 0 5.77612 0 5.5V2.20703C0 1.76172 0.538574 1.53857 0.853516 1.85352Z" />
        </svg>
      </button>
    </div>
  )
}

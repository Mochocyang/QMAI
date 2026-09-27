import closeActive from "macos-traffic-lights/svg/close/active.svg?url"
import closeDefault from "macos-traffic-lights/svg/close/default.svg?url"
import closeHover from "macos-traffic-lights/svg/close/hover.svg?url"
import maximizeActive from "macos-traffic-lights/svg/maximize/active.svg?url"
import maximizeDefault from "macos-traffic-lights/svg/maximize/default.svg?url"
import maximizeHover from "macos-traffic-lights/svg/maximize/hover.svg?url"
import minimizeActive from "macos-traffic-lights/svg/minimize/active.svg?url"
import minimizeDefault from "macos-traffic-lights/svg/minimize/default.svg?url"
import minimizeHover from "macos-traffic-lights/svg/minimize/hover.svg?url"

interface MacTrafficLightsProps {
  onClose: () => void
  onMinimize: () => void
  onZoom: () => void
}

function TrafficButton({ label, onClick, idle, hover, pressed }: {
  label: string
  onClick: () => void
  idle: string
  hover: string
  pressed: string
}) {
  return (
    <button type="button" className="ui-test-traffic-btn" aria-label={label} title={label} onClick={onClick}>
      <img className="ui-test-traffic-glyph is-idle" src={idle} alt="" draggable={false} />
      <img className="ui-test-traffic-glyph is-hover" src={hover} alt="" draggable={false} />
      <img className="ui-test-traffic-glyph is-pressed" src={pressed} alt="" draggable={false} />
    </button>
  )
}

export function MacTrafficLights({ onClose, onMinimize, onZoom }: MacTrafficLightsProps) {
  return (
    <div className="ui-test-win-actions ui-test-traffic">
      <TrafficButton label="关闭窗口" onClick={onClose} idle={closeDefault} hover={closeHover} pressed={closeActive} />
      <TrafficButton label="最小化" onClick={onMinimize} idle={minimizeDefault} hover={minimizeHover} pressed={minimizeActive} />
      <TrafficButton label="最大化或还原" onClick={onZoom} idle={maximizeDefault} hover={maximizeHover} pressed={maximizeActive} />
    </div>
  )
}

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"

export function ModelSecretInput({ value, onChange, label = "API 密钥", id }: { value: string; onChange: (value: string) => void; label?: string; id?: string }) {
  const [visible, setVisible] = useState(false)
  return <div className="model-secret-input"><input id={id} aria-label={label} type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} placeholder="请输入 API 密钥" autoComplete="off" spellCheck={false} /><button type="button" aria-pressed={visible} aria-label={visible ? "隐藏密钥" : "显示密钥"} title={visible ? "隐藏密钥" : "显示密钥"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</button></div>
}

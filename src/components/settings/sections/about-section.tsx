import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { getClipServerConfig, type ClipServerRuntimeConfig } from "@/commands/clip-server"

export function AboutSection() {
  const { t } = useTranslation()
  const [clipServer, setClipServer] = useState<ClipServerRuntimeConfig | null>(null)

  useEffect(() => {
    let alive = true
    getClipServerConfig()
      .then((config) => {
        if (alive) setClipServer(config)
      })
      .catch(() => {
        if (alive) setClipServer({ enabled: true, port: 19827, status: "unknown" })
      })
    return () => {
      alive = false
    }
  }, [])
  const clipStatus = clipServer?.status ?? "..."
  const clipPort = clipServer?.port ?? 19827

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t("settings.sections.about.version"), value: `v${__APP_VERSION__}`, mono: true },
    { label: t("settings.sections.about.clipServer"), value: `${clipStatus}  @  127.0.0.1:${clipPort}`, mono: true },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.about.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.about.description")}
        </p>
      </div>

      <div className="rounded-md border divide-y">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className={`text-sm ${r.mono ? "font-mono" : ""}`}>{r.value}</span>
          </div>
        ))}
      </div>

    </div>
  )
}

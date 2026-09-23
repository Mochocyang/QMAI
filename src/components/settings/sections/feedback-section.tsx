import { useEffect, useRef, useState } from "react"
import * as Sentry from "@sentry/react"
import { useTranslation } from "react-i18next"

type OfficialFeedbackForm = Awaited<
  ReturnType<NonNullable<ReturnType<typeof Sentry.getFeedback>>["createForm"]>
>

const FEEDBACK_HOST_ID = "sentry-feedback"

const EMBED_STYLE = `
.dialog,
.dialog__position,
.success__position {
  position: static !important;
  inset: auto !important;
  z-index: auto !important;
  display: block !important;
  width: 100% !important;
  height: auto !important;
  max-height: none !important;
  padding: 0 !important;
  background: transparent !important;
}
.dialog__header {
  display: none !important;
}
.dialog__title,
.form__right {
  width: 100% !important;
}
.dialog__content {
  max-width: none !important;
}
.form__label__text {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
}
.form__input {
  min-height: 32px;
  font-size: 0.875rem;
  font-weight: 400;
  padding: 4px 10px;
}
.form__input--textarea {
  min-height: 180px;
  padding: 8px 10px;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1;
  text-align: center;
}
.btn--default {
  display: none !important;
}
`

function themeToken(name: string, fallback = ""): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function appColorScheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function releaseBodyScroll(): void {
  document.body.style.overflow = ""
}

function applyAppTheme(host: HTMLElement): void {
  const foreground = themeToken("--foreground")
  const background = themeToken("--background")
  const card = themeToken("--card", background)
  const primary = themeToken("--primary")
  const primaryForeground = themeToken("--primary-foreground")
  const border = themeToken("--border")
  const input = themeToken("--input", border)
  const ring = themeToken("--ring", primary)
  const destructive = themeToken("--destructive")
  const mutedForeground = themeToken("--muted-foreground", foreground)
  const radius = themeToken("--radius", "0.5rem")
  const font = themeToken("--qmai-ui-font-family", "inherit")

  host.style.setProperty("--font-family", font)
  host.style.setProperty("--font-size", "14px")
  host.style.setProperty("--foreground", foreground)
  host.style.setProperty("--background", card)
  host.style.setProperty("--accent-foreground", primaryForeground)
  host.style.setProperty("--accent-background", primary)
  host.style.setProperty("--error-color", destructive)
  host.style.setProperty("--success-color", primary)
  host.style.setProperty("--border", `1px solid ${border}`)
  host.style.setProperty("--outline", `1px solid ${ring}`)
  host.style.setProperty("--box-shadow", "none")
  host.style.setProperty("--dialog-background", card)
  host.style.setProperty("--dialog-border", `1px solid ${border}`)
  host.style.setProperty("--dialog-border-radius", radius)
  host.style.setProperty("--dialog-padding", "16px")
  host.style.setProperty("--dialog-box-shadow", "none")
  host.style.setProperty("--input-color", foreground)
  host.style.setProperty("--input-border", `1px solid ${input}`)
  host.style.setProperty("--input-border-radius", radius)
  host.style.setProperty("--input-placeholder-color", mutedForeground)
  host.style.setProperty("--button-primary-background", primary)
  host.style.setProperty("--button-primary-hover-background", primary)
  host.style.setProperty("--button-primary-color", primaryForeground)
  host.style.setProperty("--button-primary-hover-color", primaryForeground)
  host.style.setProperty("--button-primary-border", "1px solid transparent")
  host.style.setProperty("--button-primary-border-radius", radius)
}

function embedOfficialForm(container: HTMLElement): HTMLElement | null {
  const host = document.getElementById(FEEDBACK_HOST_ID)
  if (!host) return null

  host.style.setProperty("--form-width", "100%")
  host.style.setProperty("--page-margin", "0px")
  host.style.setProperty("--inset", "auto")
  host.style.setProperty("--z-index", "1")
  host.style.width = "100%"
  host.style.display = "block"
  host.style.position = "static"

  Sentry.getFeedback()?.setTheme(appColorScheme())
  applyAppTheme(host)

  if (host.parentElement !== container) {
    container.appendChild(host)
  }

  const shadow = host.shadowRoot
  if (shadow) {
    let style = shadow.querySelector("style[data-qmai-embed]")
    if (!style) {
      style = document.createElement("style")
      style.setAttribute("data-qmai-embed", "")
      shadow.appendChild(style)
    }
    style.textContent = EMBED_STYLE
  }

  return host
}

function returnFeedbackHost(): void {
  const host = document.getElementById(FEEDBACK_HOST_ID)
  if (host && host.parentElement !== document.body) {
    document.body.appendChild(host)
  }
}

export function FeedbackSection() {
  const { t, i18n } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<OfficialFeedbackForm | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const container = hostRef.current
    let cancelled = false

    void (async () => {
      formRef.current?.removeFromDom()
      formRef.current = null
      if (!container) return

      const feedback = Sentry.getFeedback()
      if (!feedback) {
        if (!cancelled) setUnavailable(true)
        return
      }

      const form = await feedback.createForm({
        colorScheme: appColorScheme(),
        formTitle: t("settings.sections.feedback.formTitle"),
        submitButtonLabel: t("settings.sections.feedback.submit"),
        cancelButtonLabel: t("settings.sections.feedback.cancel"),
        nameLabel: t("settings.sections.feedback.name"),
        namePlaceholder: t("settings.sections.feedback.namePlaceholder"),
        emailLabel: t("settings.sections.feedback.email"),
        emailPlaceholder: t("settings.sections.feedback.emailPlaceholder"),
        messageLabel: t("settings.sections.feedback.message"),
        messagePlaceholder: t("settings.sections.feedback.messagePlaceholder"),
        isRequiredLabel: t("settings.sections.feedback.required"),
        successMessageText: t("settings.sections.feedback.success"),
        tags: { source: "settings" },
        onFormClose: () => {
          formRef.current?.open()
          releaseBodyScroll()
          embedOfficialForm(container)
        },
        onFormSubmitted: () => {
          formRef.current?.open()
          releaseBodyScroll()
          embedOfficialForm(container)
        },
      })

      if (cancelled) {
        form.removeFromDom()
        return
      }

      formRef.current = form
      setUnavailable(false)
      form.appendToDom()
      form.open()
      releaseBodyScroll()
      embedOfficialForm(container)
    })()

    const syncTheme = () => {
      if (container) embedOfficialForm(container)
    }
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

    return () => {
      cancelled = true
      observer.disconnect()
      formRef.current?.close()
      formRef.current?.removeFromDom()
      formRef.current = null
      releaseBodyScroll()
      returnFeedbackHost()
    }
  }, [i18n.language, t])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.feedback.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.feedback.description")}
        </p>
      </div>
      {unavailable ? (
        <p className="text-sm text-destructive">{t("settings.sections.feedback.unavailable")}</p>
      ) : (
        <div ref={hostRef} className="min-h-96 w-full" />
      )}
    </div>
  )
}

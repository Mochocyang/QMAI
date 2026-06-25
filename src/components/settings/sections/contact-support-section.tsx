import { HeartHandshake, MessageCircle, QrCode } from "lucide-react"
import { useTranslation } from "react-i18next"
import wechatContactImage from "@/assets/support/wechat-contact.jpg"
import wechatPayImage from "@/assets/support/wechat-pay.jpg"
import alipayPayImage from "@/assets/support/alipay-pay.jpg"

const DONATION_CHANNELS = [
  {
    key: "wechatPay",
    image: wechatPayImage,
  },
  {
    key: "alipayPay",
    image: alipayPayImage,
  },
] as const

export function ContactSupportSection() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.contactSupport.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.contactSupport.description")}
        </p>
      </div>

      <section className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <MessageCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">
              {t("settings.sections.contactSupport.contact.title")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("settings.sections.contactSupport.contact.description")}
            </p>
            <div className="mt-4 flex justify-center sm:justify-start">
              <img
                src={wechatContactImage}
                alt={t("settings.sections.contactSupport.contact.alt")}
                className="max-h-[420px] w-full max-w-[320px] rounded-md border border-border bg-background object-contain"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <HeartHandshake className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">
              {t("settings.sections.contactSupport.donation.title")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("settings.sections.contactSupport.donation.description")}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {DONATION_CHANNELS.map((channel) => (
                <div key={channel.key} className="rounded-md border border-border/70 bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <QrCode className="h-4 w-4 text-primary" />
                    <span>{t(`settings.sections.contactSupport.donation.${channel.key}.title`)}</span>
                  </div>
                  <img
                    src={channel.image}
                    alt={t(`settings.sections.contactSupport.donation.${channel.key}.alt`)}
                    className="aspect-[3/4] w-full rounded-md bg-background object-contain"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

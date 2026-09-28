import { MessageCircle, QrCode } from "lucide-react"
import { useTranslation } from "react-i18next"
import wechatContactImage from "@/assets/support/wechat-contact.jpg"
import wechatPayImage from "@/assets/support/wechat-pay.jpg"
import alipayPayImage from "@/assets/support/alipay-pay.jpg"

const CARDS: Array<{
  key: "wechat" | "wechatPay" | "alipayPay"
  titleKey: string
  descriptionKey: string
  altKey: string
  image: string
}> = [
  {
    key: "wechat",
    titleKey: "settings.sections.contactSupport.contact.title",
    descriptionKey: "settings.sections.contactSupport.contact.description",
    altKey: "settings.sections.contactSupport.contact.alt",
    image: wechatContactImage,
  },
  {
    key: "wechatPay",
    titleKey: "settings.sections.contactSupport.donation.wechatPay.title",
    descriptionKey: "settings.sections.contactSupport.donation.description",
    altKey: "settings.sections.contactSupport.donation.wechatPay.alt",
    image: wechatPayImage,
  },
  {
    key: "alipayPay",
    titleKey: "settings.sections.contactSupport.donation.alipayPay.title",
    descriptionKey: "settings.sections.contactSupport.donation.description",
    altKey: "settings.sections.contactSupport.donation.alipayPay.alt",
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

      {/* 三张二维码同屏展示，避免需要滚动才能看完 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <div key={card.key} className="flex flex-col rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                {card.key === "wechat" ? (
                  <MessageCircle className="h-4 w-4" />
                ) : (
                  <QrCode className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">{t(card.titleKey)}</h3>
              </div>
            </div>
            <p className="mt-1 px-1 text-xs leading-5 text-muted-foreground">
              {t(card.descriptionKey)}
            </p>
            <div className="mt-3 flex flex-1 items-center justify-center">
              <img
                src={card.image}
                alt={t(card.altKey)}
                className="max-h-[260px] w-full max-w-[320px] rounded-md border border-border bg-background object-contain"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

import { useTranslation } from "react-i18next"
import { ResourceLink } from "./resource-link"

/**
 * 模型设置教程（飞书 wiki）。
 *
 * 只挂在「大语言模型 / 重排模型 / 向量模型」三个页签：「默认模型」不涉及
 * 接口地址、密钥与模型名，挂教程反而误导。
 */
export const MODEL_SETTINGS_TUTORIAL_URL =
  "https://tcnk9ik08e1c.feishu.cn/wiki/FWiSwYQKoifpwBk6mSRcSlB8nrh?from=from_copylink"

export function ModelTutorialLink() {
  const { t } = useTranslation()
  return (
    <ResourceLink
      href={MODEL_SETTINGS_TUTORIAL_URL}
      title={t("settings.modelTutorialLinkHint", {
        defaultValue: "模型设置教程：怎么申请密钥、填接口地址、配向量与重排模型",
      })}
    >
      {t("settings.modelTutorialLink", { defaultValue: "模型设置教程" })}
    </ResourceLink>
  )
}

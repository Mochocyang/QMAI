import { BookOpen, FileText, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ResourceLink } from "../resource-link"

const GUIDE_LINKS = [
  {
    title: "青幕AI写作完整使用说明",
    description: "从安装、模型配置到资料库、小说创作流程的完整说明。",
    url: "https://tcnk9ik08e1c.feishu.cn/wiki/EgjtwCVpCiuOISky1HMcRCQhnhf?from=from_copylink",
    icon: BookOpen,
  },
  {
    title: "青幕AI写作正式用户手册",
    description: "适合正式使用时查阅的功能说明和操作细节。",
    url: "https://tcnk9ik08e1c.feishu.cn/wiki/C7riwVB4HiImwjkOZ6wc7TR3n7f?from=from_copylink",
    icon: FileText,
  },
  {
    title: "青幕AI小说介绍",
    description: "了解小说写作模式、章节库、大纲库和记忆能力。",
    url: "https://tcnk9ik08e1c.feishu.cn/wiki/AX0cwcCL5it4fFkAi01c4oA5nFb?from=from_copylink",
    icon: Sparkles,
  },
]

export function UsageGuideSection() {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.usageGuide.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.usageGuide.description")}
        </p>
      </div>

      <div className="space-y-3">
        {GUIDE_LINKS.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.url} className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{item.title}</h3>
                    <ResourceLink href={item.url} title={item.title}>
                      {t("settings.sections.usageGuide.open")}
                    </ResourceLink>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

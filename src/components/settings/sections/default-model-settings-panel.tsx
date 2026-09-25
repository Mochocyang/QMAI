import { UiTestDefaultModels } from "@/components/uitest/models/default-models"
import { useWikiStore } from "@/stores/wiki-store"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

/**
 * 默认模型设置面板（新版）：直接挂载测试版「默认模型」标签页实现。
 * 旧版分环节模型选择面板已在新版 UI 分支冻结后删除。
 */
export function DefaultModelSettingsPanel({ draft: _draft, setDraft: _setDraft }: Props) {
  const project = useWikiStore((s) => s.project)
  return <UiTestDefaultModels key={project?.id ?? "global"} />
}

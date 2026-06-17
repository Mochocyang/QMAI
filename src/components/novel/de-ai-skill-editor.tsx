import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, writeFile } from "@/commands/fs"
import { join } from "@tauri-apps/api/path"

// 从新的skill文件导入默认规则
import defaultDeAiSkill from "../../../skills/de-ai-writing/SKILL.md?raw"

const DEFAULT_DE_AI_SKILL = defaultDeAiSkill.trim()

export function DeAiSkillEditor() {
  const project = useWikiStore((s) => s.project)
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [isDefault, setIsDefault] = useState(true)

  useEffect(() => {
    if (!project) return
    loadSkill()
  }, [project?.path])

  async function loadSkill() {
    if (!project) return
    try {
      const skillPath = await join(project.path, "de-ai-skill.txt")
      const skillContent = await readFile(skillPath)
      setContent(skillContent)
      setIsDefault(false)
    } catch {
      setContent(DEFAULT_DE_AI_SKILL)
      setIsDefault(true)
    }
  }

  async function handleSave() {
    if (!project) return
    setSaving(true)
    try {
      const skillPath = await join(project.path, "de-ai-skill.txt")
      await writeFile(skillPath, content)
      setMessage("保存成功")
      setIsDefault(false)
    } catch {
      setMessage("保存失败，请稍后重试")
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(""), 2000)
    }
  }

  async function handleReset() {
    setContent(DEFAULT_DE_AI_SKILL)
    setMessage("已重置为默认规则")
    setTimeout(() => setMessage(""), 2000)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Label>去AI味Skill</Label>
        <p className="text-sm text-muted-foreground mt-1">
          自定义去AI味规则，将应用到全局所有去AI味功能（章节去AI味、选中文本去AI味、AI会话深度思考阶段6）
        </p>
        {isDefault && (
          <p className="text-xs text-amber-600 mt-2">
            当前使用系统默认skill（de-AI-writing - 12项硬门槛 + 24项AI痕迹检测）。保存后将创建项目自定义规则文件，优先级最高。
          </p>
        )}
      </div>
      <Textarea
        className="min-h-[400px] font-mono text-sm"
        placeholder="在此输入你的去AI味规则..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving || content.trim() === ""}>
          {saving ? "保存中..." : "保存"}
        </Button>
        <Button onClick={handleReset} variant="outline" disabled={saving}>
          重置为默认
        </Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        <div className="font-medium mb-2">使用提示：</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>编辑规则后点击"保存"，将自动应用到所有去AI味功能</li>
          <li>系统默认使用 de-AI-writing skill（保真改写，适合网络小说）</li>
          <li>支持多行文本，可以使用分点、分段的形式组织规则</li>
          <li>规则会保存为项目根目录下的 de-ai-skill.txt 文件（优先级最高）</li>
          <li>完整skill系统位于软件安装目录的 skills/ 文件夹，包含 references/ 详细规则</li>
        </ul>
      </div>
    </div>
  )
}

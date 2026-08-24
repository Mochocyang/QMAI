import { create } from "zustand"
import { normalizePath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
import { useWikiStore } from "@/stores/wiki-store"
import {
  loadUserSkillConfig,
  saveUserSkillConfig,
  loadLinkedSkillContent,
} from "@/lib/novel/user-skill-store"
import {
  loadDeAiSkillConfig,
  saveDeAiSkillConfig,
  BUILT_IN_DE_AI_SKILLS,
} from "@/lib/novel/de-ai-skill-library"
import { DEFAULT_SKILL_PRIORITY, type UserSkill, type SkillCategory } from "@/lib/novel/skill-library"
import type { DeAiSkill } from "@/lib/novel/de-ai-skill-library"
import {
  type FavoriteSkillEntry,
  type FavoriteSkillLibrary,
  type FavoriteSkillConfig,
  type FavoriteSkillSnapshot,
  type FavoriteSkillSource,
  loadFavorites,
  saveFavorites,
  buildWritingSnapshot,
  buildDeAiSnapshot,
} from "@/lib/novel/skill-favorite"

interface ToggleFavoriteParams {
  library: FavoriteSkillLibrary
  skill: UserSkill | DeAiSkill
  originProjectPath?: string
  writingCategories?: SkillCategory[]
}

interface FavoriteSkillState {
  favorites: FavoriteSkillEntry[]
  currentProjectPath: string
  loaded: boolean
  loading: boolean

  load: (projectPath: string) => Promise<void>
  toggleFavorite: (params: ToggleFavoriteParams) => Promise<void>
  removeFavorite: (favoriteId: string) => Promise<void>
  isFavorited: (library: FavoriteSkillLibrary, skillId: string) => boolean
  copyToCurrentProject: (favoriteId: string) => Promise<{
    ok: boolean
    reason?: "duplicate-name" | "write-failed" | "empty-content" | "no-project"
  }>
}

export const useFavoriteSkillStore = create<FavoriteSkillState>((set, get) => ({
  favorites: [],
  currentProjectPath: "",
  loaded: false,
  loading: false,

  load: async (projectPath) => {
    set({ loading: true })
    try {
      const config = await loadFavorites()
      // v5 R4：守卫必须用 normalizePath，与 App.tsx isCurrentProject 一致
      const current = useWikiStore.getState().project
      if (!current || normalizePath(current.path) !== normalizePath(projectPath)) return
      set({ favorites: config.favorites, currentProjectPath: projectPath, loaded: true })
    } catch {
      toast.error("收藏加载失败")
    } finally {
      set({ loading: false })
    }
  },

  toggleFavorite: async ({ library, skill, originProjectPath, writingCategories }) => {
    const currentProjectPath = get().currentProjectPath

    // 1. 固化 content + v4 R3：内置去AI味整体替换为原版对象
    let content = skill.content
    let effectiveSkill: UserSkill | DeAiSkill = skill

    try {
      if (library === "writing" && skill.source === "linked") {
        // writing 链接技能需读取真实文件内容（文件可能被删/移动，需捕获异常）
        content = await loadLinkedSkillContent(skill as UserSkill)
      }
    } catch (err) {
      console.error("[favorite] 读取链接技能内容失败:", err)
      toast.error("读取链接技能文件失败，无法收藏")
      return
    }

    if (library === "de-ai" && skill.source === "built-in") {
      // v4 R3：name/description/content/templateId 全部用 BUILT_IN_DE_AI_SKILLS 原版
      const original = BUILT_IN_DE_AI_SKILLS.find((s) => s.id === skill.id)
      if (original) {
        effectiveSkill = original
        content = original.content
      }
    }

    // 2. v5 N11：用 if 分支结构 + 必要的 as 断言（library 与 skill 是独立参数，TS 无法自动窄化）
    let snapshot: FavoriteSkillSnapshot
    if (library === "writing") {
      snapshot = buildWritingSnapshot(effectiveSkill as UserSkill, content, writingCategories ?? [])
    } else {
      snapshot = buildDeAiSnapshot(effectiveSkill as DeAiSkill, content)
    }

    // 3. 构造 entry
    const entry: FavoriteSkillEntry = {
      favoriteId: crypto.randomUUID(),
      library,
      skillId: skill.id,
      originProjectPath: skill.source === "built-in" ? "" : (originProjectPath || currentProjectPath),
      source: skill.source as FavoriteSkillSource,
      snapshot,
      favoritedAt: Date.now(),
    }

    // 4. 三元组查重：已存在则移除（toggle），否则添加
    const existingIndex = get().favorites.findIndex(
      (f) =>
        f.library === entry.library &&
        f.skillId === entry.skillId &&
        f.originProjectPath === entry.originProjectPath,
    )

    let nextFavorites: FavoriteSkillEntry[]
    let toastMessage: string
    if (existingIndex >= 0) {
      nextFavorites = [...get().favorites]
      nextFavorites.splice(existingIndex, 1)
      toastMessage = `已取消收藏「${entry.snapshot.name}」`
    } else {
      nextFavorites = [...get().favorites, entry]
      toastMessage = `已收藏「${entry.snapshot.name}」`
    }

    // 5. 乐观更新 + 异步写 web-store（串行化）
    const previousFavorites = get().favorites
    set({ favorites: nextFavorites })
    try {
      const config: FavoriteSkillConfig = { version: 1, favorites: nextFavorites }
      await saveFavorites(config)
      toast.success(toastMessage)
    } catch (err) {
      console.error("[favorite] 保存失败:", err)
      set({ favorites: previousFavorites })
      toast.error("收藏保存失败，请重试")
    }
  },

  removeFavorite: async (favoriteId) => {
    const previousFavorites = get().favorites
    const nextFavorites = previousFavorites.filter((f) => f.favoriteId !== favoriteId)
    set({ favorites: nextFavorites })
    try {
      const config: FavoriteSkillConfig = { version: 1, favorites: nextFavorites }
      await saveFavorites(config)
    } catch (err) {
      console.error("[favorite] 删除失败:", err)
      set({ favorites: previousFavorites })
      toast.error("删除失败，请重试")
    }
  },

  // v5 N1：isFavorited 只需 2 参数（id 命名空间已隔离）
  isFavorited: (library, skillId) => {
    return get().favorites.some((f) => f.library === library && f.skillId === skillId)
  },

  copyToCurrentProject: async (favoriteId) => {
    const { favorites, currentProjectPath } = get()
    const entry = favorites.find((f) => f.favoriteId === favoriteId)
    if (!entry) return { ok: false }

    // v5 N9/N13：currentProjectPath 空检查（防御性编程）
    if (!currentProjectPath) {
      toast.error("请先打开一个项目再复制")
      return { ok: false, reason: "no-project" }
    }

    // v4 R1/R2/R6：content 非空检查，防止复制后被 normalize 静默丢弃
    if (!entry.snapshot.content.trim()) {
      toast.error("原技能内容为空，无法复制")
      return { ok: false, reason: "empty-content" }
    }

    const now = Date.now()

    // v5 N14：整个写入逻辑用 try/catch 包裹，写失败返回 write-failed
    try {
      if (entry.library === "writing") {
        const config = await loadUserSkillConfig(currentProjectPath)
        if (config.skills.some((s) => s.name === entry.snapshot.name)) {
          return { ok: false, reason: "duplicate-name" }
        }
        const newSkill: UserSkill = {
          id: `skill:${now}`,
          name: entry.snapshot.name,
          description: entry.snapshot.description,
          content: entry.snapshot.content,
          kind: entry.snapshot.kind,
          stages: entry.snapshot.stages,
          modes: entry.snapshot.modes,
          source: "uploaded",
          priority: DEFAULT_SKILL_PRIORITY,
          tags: [],
          categoryId: "",
        }
        await saveUserSkillConfig(currentProjectPath, {
          ...config,
          skills: [...config.skills, newSkill],
        })
      } else {
        const config = await loadDeAiSkillConfig(currentProjectPath)
        if (config.projectSkills.some((s) => s.name === entry.snapshot.name)) {
          return { ok: false, reason: "duplicate-name" }
        }
        const newSkill: DeAiSkill = {
          id: `project:${now}`,
          name: entry.snapshot.name,
          description: entry.snapshot.description,
          content: entry.snapshot.content,
          source: "project",
          templateId: entry.snapshot.templateId || "custom",
          createdAt: now,
          updatedAt: now,
        }
        await saveDeAiSkillConfig(currentProjectPath, {
          ...config,
          projectSkills: [...config.projectSkills, newSkill],
        })
      }
    } catch (err) {
      console.error("[favorite] 复制到当前项目失败:", err)
      toast.error("复制失败，请重试")
      return { ok: false, reason: "write-failed" }
    }

    useWikiStore.getState().bumpDataVersion()
    toast.info("已复制到当前项目，可在 [写作/去AI味] Tab 查看")
    return { ok: true }
  },
}))

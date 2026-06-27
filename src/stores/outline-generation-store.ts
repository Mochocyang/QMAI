import { create } from "zustand"

export type OutlineTaskStatus = "generating" | "generated" | "ingesting" | "done" | "error"
export type OutlineTaskKind = "outline" | "refine" | "ingest"

export interface OutlineGenerationTask {
  id: string
  projectPath: string
  kind: OutlineTaskKind
  genre: string
  scale: string
  premise: string
  prompt: string
  channel?: "male" | "female"
  mainGenre?: string
  subGenres?: string[]
  customTags?: string[]
  modelId?: string
  userRequest: string
  selectedSectionKey: string | null
  displayTitle: string | null
  writeMode: string | null
  targetPath: string | null
  outlinePath: string | null
  status: OutlineTaskStatus
  message: string
  error: string | null
  createdAt: number
  updatedAt: number
}

interface CreateOutlineTaskInput {
  projectPath: string
  kind?: OutlineTaskKind
  genre?: string
  scale?: string
  premise?: string
  prompt?: string
  channel?: "male" | "female"
  mainGenre?: string
  subGenres?: string[]
  customTags?: string[]
  modelId?: string
  userRequest?: string
  selectedSectionKey?: string | null
  displayTitle?: string | null
  writeMode?: string | null
  targetPath?: string | null
  outlinePath?: string | null
  status?: OutlineTaskStatus
  message?: string
  error?: string | null
}

export interface OutlineGenerationState {
  tasks: OutlineGenerationTask[]
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  createTask: (input: CreateOutlineTaskInput) => string
  updateTask: (taskId: string, patch: Partial<OutlineGenerationTask>) => void
  getLatestTaskByProject: (projectPath: string) => OutlineGenerationTask | null
  removeTask: (taskId: string) => void
}

let counter = 0

export const useOutlineGenerationStore = create<OutlineGenerationState>((set) => ({
  tasks: [],
  panelOpen: false,
  setPanelOpen: (open) => set({ panelOpen: open }),
  createTask: (input) => {
    const id = `outline-task-${++counter}`
    const now = Date.now()
    set((state) => ({
      tasks: [
        {
          id,
          ...input,
          kind: input.kind ?? "outline",
          genre: input.genre ?? "",
          scale: input.scale ?? "",
          premise: input.premise ?? "",
          prompt: input.prompt ?? "",
          channel: input.channel,
          mainGenre: input.mainGenre,
          subGenres: input.subGenres,
          customTags: input.customTags,
          modelId: input.modelId,
          userRequest: input.userRequest ?? "",
          selectedSectionKey: input.selectedSectionKey ?? null,
          displayTitle: input.displayTitle ?? null,
          writeMode: input.writeMode ?? null,
          targetPath: input.targetPath ?? null,
          outlinePath: input.outlinePath ?? null,
          status: input.status ?? "generating",
          message: input.message ?? "",
          error: input.error ?? null,
          createdAt: now,
          updatedAt: now,
        },
        ...state.tasks,
      ],
    }))
    return id
  },
  updateTask: (taskId, patch) => set((state) => ({
    tasks: state.tasks.map((task) =>
      task.id === taskId
        ? { ...task, ...patch, updatedAt: Date.now() }
        : task,
    ),
  })),
  getLatestTaskByProject: (projectPath: string): OutlineGenerationTask | null => {
    const tasks: OutlineGenerationTask[] = useOutlineGenerationStore.getState().tasks
      .filter((task: OutlineGenerationTask) => task.projectPath === projectPath)
      .sort((a: OutlineGenerationTask, b: OutlineGenerationTask) => b.updatedAt - a.updatedAt)
    return tasks[0] ?? null
  },
  removeTask: (taskId: string) => set((state) => ({
    tasks: state.tasks.filter((task) => task.id !== taskId),
  })),
}))

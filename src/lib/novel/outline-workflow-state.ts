export type OutlineWorkflowStage =
  | "idle"
  | "intent_analysis"
  | "waiting_user_input"
  | "collecting_requirements"
  | "sufficiency_check"
  | "generation_plan"
  | "waiting_user_confirm"
  | "multi_agent_planning"
  | "running_subagents"
  | "merging_results"
  | "quality_check"
  | "auto_repair"
  | "preview"
  | "waiting_save_confirm"
  | "saved"

export interface OutlineWorkflowState {
  stage: OutlineWorkflowStage
  history: OutlineWorkflowStage[]
  updatedAt: number
}

const ALLOWED_TRANSITIONS: Record<OutlineWorkflowStage, OutlineWorkflowStage[]> = {
  idle: ["intent_analysis", "collecting_requirements"],
  intent_analysis: ["sufficiency_check", "waiting_user_input"],
  waiting_user_input: ["sufficiency_check"],
  collecting_requirements: ["sufficiency_check"],
  sufficiency_check: ["generation_plan", "collecting_requirements"],
  generation_plan: ["waiting_user_confirm"],
  waiting_user_confirm: ["multi_agent_planning", "collecting_requirements"],
  multi_agent_planning: ["running_subagents"],
  running_subagents: ["merging_results", "generation_plan"],
  merging_results: ["quality_check", "generation_plan"],
  quality_check: ["preview", "auto_repair"],
  auto_repair: ["quality_check"],
  preview: ["waiting_save_confirm", "auto_repair"],
  waiting_save_confirm: ["saved", "preview"],
  saved: [],
}

export function createInitialOutlineWorkflowState(): OutlineWorkflowState {
  return {
    stage: "idle",
    history: ["idle"],
    updatedAt: Date.now(),
  }
}

export function canTransitionOutlineWorkflow(
  from: OutlineWorkflowStage,
  to: OutlineWorkflowStage,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function transitionOutlineWorkflow(
  state: OutlineWorkflowState,
  nextStage: OutlineWorkflowStage,
): OutlineWorkflowState {
  if (!canTransitionOutlineWorkflow(state.stage, nextStage)) {
    throw new Error(`AI大纲工作流不能从「${state.stage}」跳转到「${nextStage}」。`)
  }
  return {
    stage: nextStage,
    history: [...state.history, nextStage],
    updatedAt: Date.now(),
  }
}

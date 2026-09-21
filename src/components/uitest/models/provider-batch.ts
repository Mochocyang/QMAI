import { confirmModelAction } from "./model-confirm"
import { useEffect, useRef, useState } from "react"
import type { LlmConfig, ProviderOverride } from "@/stores/wiki-store"
import { testSettingsLlmModel } from "@/lib/settings-model-test"
import { safeModelError } from "./model-feedback"

interface BatchState { loading: boolean; success: boolean; message: string; failedModels?: string[] }
const IDLE: BatchState = { loading: false, success: false, message: "" }
/** 测试版批测：编辑或离开后不再发送后续请求；已经发出的单次请求仍由原引擎超时处理。 */
export function useUiTestProviderBatch(draft: ProviderOverride, enabled: boolean) {
  const [modelTestState, setState] = useState<BatchState>(IDLE)
  const signature = JSON.stringify(draft)
  const previous = useRef(signature), revision = useRef(0), alive = useRef(true), busy = useRef(false)
  if (signature !== previous.current) { previous.current = signature; revision.current++; busy.current = false }
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++ } }, [])
  useEffect(() => { if (enabled) setState(IDLE) }, [signature, enabled])
  async function runBatchTest(models: string[], buildConfig: (model: string) => LlmConfig) {
    if (!enabled || busy.current) return
    if (!models.length || models.some(model => !model.trim())) { setState({ ...IDLE, message: "请先输入或选择模型。" }); return }
    if (!(await confirmModelAction(`将测试 ${models.length} 个模型，可能消耗 token 和费用；不会保存配置。是否继续？`))) return
    const generation = ++revision.current
    const current = () => alive.current && revision.current === generation
    busy.current = true; setState({ loading: true, success: false, message: "正在测试…" })
    const failedModels: string[] = [], errors: string[] = []
    try {
      for (const [index, model] of models.entries()) {
        if (!current()) return
        const config = buildConfig(model)
        setState({ loading: true, success: false, message: `正在测试 ${index + 1}/${models.length}：${model}` })
        try { await testSettingsLlmModel(config) }
        catch (error) { failedModels.push(model); errors.push(`${model}：${safeModelError(error, [config.apiKey])}`) }
        if (!current()) return
      }
      setState({ loading: false, success: failedModels.length === 0, failedModels, message: failedModels.length ? `测试完成，${models.length - failedModels.length}/${models.length} 通过。${errors.join("；")}` : `测试通过（${models.length}/${models.length}）。本次测试没有保存配置。` })
    } finally { if (current()) busy.current = false }
  }
  const retryFailed = (buildConfig: (model: string) => LlmConfig) => runBatchTest(modelTestState.failedModels ?? [], buildConfig)
  return { modelTestState, runBatchTest, retryFailed }
}

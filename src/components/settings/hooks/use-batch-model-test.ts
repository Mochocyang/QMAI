import { useState, useCallback } from "react"
import { testSettingsLlmModel } from "@/lib/settings-model-test"
import type { LlmConfig } from "@/stores/wiki-store"

export interface BatchModelTestState {
  loading: boolean
  success: boolean
  message: string
  failedModels?: string[]
}

export interface UseBatchModelTestResult {
  modelTestState: BatchModelTestState
  runBatchTest: (modelsToTest: string[], buildConfig: (modelId: string) => LlmConfig) => Promise<void>
  retryFailed: (buildConfig: (modelId: string) => LlmConfig) => Promise<void>
  clearTestState: () => void
  removeFailedModel: (modelId: string) => void
}

export function useBatchModelTest(
  t: (key: string, params?: Record<string, string | number>) => string
): UseBatchModelTestResult {
  const [modelTestState, setModelTestState] = useState<BatchModelTestState>({
    loading: false,
    success: false,
    message: "",
  })

  const runBatchTest = useCallback(
    async (modelsToTest: string[], buildConfig: (modelId: string) => LlmConfig) => {
      if (modelsToTest.length === 0 || modelsToTest.some((m) => !m)) {
        setModelTestState({
          loading: false,
          success: false,
          message: "请先输入或选择模型",
        })
        return
      }

      setModelTestState({
        loading: true,
        success: false,
        message: t("settings.sections.shared.testing"),
      })

      const results: { model: string; ok: boolean; error?: string }[] = []

      try {
        for (let i = 0; i < modelsToTest.length; i++) {
          const modelId = modelsToTest[i]
          setModelTestState({
            loading: true,
            success: false,
            message: t("settings.sections.llm.testingModelProgress", {
              current: i + 1,
              total: modelsToTest.length,
              model: modelId,
            }),
          })

          try {
            const result = await testSettingsLlmModel(buildConfig(modelId))
            results.push({ model: result.model, ok: true })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            results.push({ model: modelId, ok: false, error: message })
          }
        }

        const successCount = results.filter((r) => r.ok).length
        const allSuccess = successCount === modelsToTest.length

        if (allSuccess) {
          setModelTestState({
            loading: false,
            success: true,
            message: t("settings.sections.llm.testModelsAllSuccess", {
              count: successCount,
              total: modelsToTest.length,
            }),
          })
        } else {
          const failedModels = results.filter((r) => !r.ok)
          const failedModelNames = failedModels.map((r) => r.model)
          const failedMessages = failedModels
            .map((r) => `${r.model}: ${r.error}`)
            .join("； ")
          setModelTestState({
            loading: false,
            success: false,
            message: t("settings.sections.llm.testModelsPartialFailed", {
              success: successCount,
              total: modelsToTest.length,
              failed: failedMessages,
            }),
            failedModels: failedModelNames,
          })
        }
      } catch (error) {
        setModelTestState({
          loading: false,
          success: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [t]
  )

  const retryFailed = useCallback(
    async (buildConfig: (modelId: string) => LlmConfig) => {
      if (!modelTestState.failedModels || modelTestState.failedModels.length === 0) return
      await runBatchTest(modelTestState.failedModels, buildConfig)
    },
    [modelTestState.failedModels, runBatchTest]
  )

  const clearTestState = useCallback(() => {
    setModelTestState({
      loading: false,
      success: false,
      message: "",
    })
  }, [])

  const removeFailedModel = useCallback((modelId: string) => {
    setModelTestState((prev) => {
      if (!prev.failedModels) return prev
      const nextFailedModels = prev.failedModels.filter((m) => m !== modelId)
      return {
        ...prev,
        failedModels: nextFailedModels,
        message:
          nextFailedModels.length === 0
            ? prev.success
              ? prev.message
              : ""
            : prev.message,
      }
    })
  }, [])

  return {
    modelTestState,
    runBatchTest,
    retryFailed,
    clearTestState,
    removeFailedModel,
  }
}

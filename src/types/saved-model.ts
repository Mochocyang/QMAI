/**
 * 已保存的模型配置项
 */
export interface SavedModel {
  /** 唯一ID */
  id: string
  /** 显示名称 */
  name: string
  /** 模型ID */
  model: string
  /** API密钥（可选，可以复用供应商的密钥） */
  apiKey?: string
  /** 自定义接口地址（可选，可以复用供应商的地址） */
  customEndpoint?: string
  /** 备注说明 */
  description?: string
  /** 创建时间 */
  createdAt: number
}

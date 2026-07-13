import { describe, expect, it } from "vitest"
import { MAX_EXPORT_FILE_NAME_LENGTH, sanitizeExportFileName, serializeTxt } from "./txt-exporter"
import type { ExportDocument } from "./types"

const document: ExportDocument = {
  title: "长安：夜雨",
  source: "chapters",
  blocks: [
    { title: "第一章 初见", paragraphs: ["长安夜雨。", "她撑伞而来。"] },
    { title: "第二章 重逢", paragraphs: ["故人再会。"] },
  ],
}

describe("TXT 导出器", () => {
  it("按标题、段落和原始块顺序生成 UTF-8 文本", () => {
    const bytes = serializeTxt(document)
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)

    expect(text).toBe(
      "长安：夜雨\n\n第一章 初见\n\n长安夜雨。\n\n她撑伞而来。\n\n第二章 重逢\n\n故人再会。\n",
    )
  })

  it("清理 Windows 非法字符并保留中文", () => {
    expect(sanitizeExportFileName(' 长安<>:"/\\|?*夜雨. ')).toBe("长安夜雨")
  })

  it("规避 Windows 设备名并限制文件名最大长度", () => {
    expect(sanitizeExportFileName("CON")).toBe("_CON")
    expect(sanitizeExportFileName("con.txt")).toBe("_con.txt")
    expect(sanitizeExportFileName("LPT9")).toBe("_LPT9")
    const longName = "长".repeat(MAX_EXPORT_FILE_NAME_LENGTH + 20)
    expect(Array.from(sanitizeExportFileName(longName))).toHaveLength(MAX_EXPORT_FILE_NAME_LENGTH)
  })

  it("文件名清理后为空时使用中文兜底名", () => {
    expect(sanitizeExportFileName("<>:\"/\\|?* .")).toBe("未命名作品")
  })
})

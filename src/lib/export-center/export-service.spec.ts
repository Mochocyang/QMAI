import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { assertExportByteLength, encodeExportBytesBase64, exportDocuments, MAX_EXPORT_BYTES, type ExportServiceDeps } from "./export-service"
import type { ExportDocument } from "./types"

const documents: ExportDocument[] = [
  { title: '作品<>:"一', source: "book-analysis", blocks: [{ title: "正文", paragraphs: ["甲"] }] },
  { title: "作品二", source: "book-analysis", blocks: [{ title: "正文", paragraphs: ["乙"] }] },
]

function deps(paths: Array<string | null>): ExportServiceDeps & {
  saveFile: ReturnType<typeof vi.fn>
  writeBinary: ReturnType<typeof vi.fn>
} {
  return {
    saveFile: vi.fn().mockImplementation(async () => paths.shift() ?? null),
    writeBinary: vi.fn().mockResolvedValue(undefined),
  }
}

describe("统一导出保存服务", () => {
  it("导出原始字节允许 64 MiB 边界并以中文拒绝超限", () => {
    expect(() => assertExportByteLength(MAX_EXPORT_BYTES)).not.toThrow()
    expect(() => assertExportByteLength(MAX_EXPORT_BYTES + 1)).toThrow("导出文件超过 64 MiB 限制")
  })

  it("将任意二进制字节稳定编码为 base64 IPC 内容", () => {
    expect(encodeExportBytesBase64(new Uint8Array([0x00, 0x80, 0xff]))).toBe("AID/")
  })
  it("取消保存窗口返回 cancelled，且不写文件", async () => {
    const adapters = deps([null])

    const result = await exportDocuments([documents[0]], "txt", adapters)

    expect(result).toEqual({ status: "cancelled", exportedCount: 0 })
    expect(adapters.writeBinary).not.toHaveBeenCalled()
  })

  it("清理默认文件名并将每部作品保存为独立 TXT 文件", async () => {
    const adapters = deps(["C:/Export/作品一.txt", "C:/Export/作品二.txt"])

    const result = await exportDocuments(documents, "txt", adapters)

    expect(result).toEqual({ status: "success", exportedCount: 2 })
    expect(adapters.saveFile.mock.calls.map((call) => call[0].defaultPath)).toEqual([
      "作品一.txt",
      "作品二.txt",
    ])
    expect(adapters.writeBinary).toHaveBeenCalledTimes(2)
    expect(new TextDecoder().decode(adapters.writeBinary.mock.calls[0][1])).toContain("甲")
  })

  it("卸载守卫失效后停止打开后续保存窗口", async () => {
    const adapters = deps(["C:/Export/作品一.txt", "C:/Export/作品二.txt"])
    let active = true
    adapters.writeBinary.mockImplementationOnce(async () => { active = false })

    const result = await exportDocuments(documents, "txt", adapters, () => active)

    expect(result).toEqual({ status: "cancelled", exportedCount: 1 })
    expect(adapters.saveFile).toHaveBeenCalledTimes(1)
  })

  it("DOCX 保存窗口和写入数据使用真实 docx 扩展名与 ZIP 字节", async () => {
    const adapters = deps(["C:/Export/作品一.docx"])

    await exportDocuments([documents[0]], "docx", adapters)

    expect(adapters.saveFile.mock.calls[0][0]).toMatchObject({
      defaultPath: "作品一.docx",
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    })
    expect(Array.from(adapters.writeBinary.mock.calls[0][1].slice(0, 2))).toEqual([0x50, 0x4b])
  })

  it("写入失败时抛出中文错误且停止后续作品", async () => {
    const adapters = deps(["C:/Export/作品一.txt", "C:/Export/作品二.txt"])
    adapters.writeBinary.mockRejectedValueOnce(new Error("disk full"))

    await expect(exportDocuments(documents, "txt", adapters)).rejects.toThrow("导出文件写入失败，请检查保存位置和磁盘空间。")
    expect(adapters.saveFile).toHaveBeenCalledTimes(1)
  })
})

it("Rust 临时文件使用同一可写句柄 write_all 和 sync_all，关闭后再原子替换", () => {
  const fsSource = readFileSync(resolve(process.cwd(), "src-tauri/src/commands/fs.rs"), "utf8")
  const exportStart = fsSource.indexOf("fn do_write_export_file_with_replace")
  const exportEnd = fsSource.indexOf("pub fn do_write_export_file(", exportStart)
  const implementation = fsSource.slice(exportStart, exportEnd)

  expect(implementation).toContain("fs::OpenOptions::new()")
  expect(implementation).toContain(".write(true)")
  expect(implementation).toContain(".create_new(true)")
  expect(implementation).toContain("file.write_all(bytes)")
  expect(implementation).toContain("file.sync_all()")
  expect(implementation).toContain("drop(file)")
  expect(implementation.indexOf("drop(file)")).toBeLessThan(implementation.indexOf("replace(&temp, destination)"))
  expect(implementation).not.toContain("fs::write(&temp, bytes)")
  expect(implementation).not.toContain("fs::File::open(&temp)")
})

it("默认二进制写入桥接在 Rust 后端实现并注册", () => {
  const fsSource = readFileSync(resolve(process.cwd(), "src-tauri/src/commands/fs.rs"), "utf8")
  const libSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8")

  expect(fsSource).toContain("pub async fn write_export_file")
  expect(fsSource).toContain("file.write_all(bytes)")
  expect(fsSource).toContain("pub fn do_write_export_file_base64")
  expect(fsSource).toContain("STANDARD as B64")
  expect(fsSource).toContain(".decode(contents_base64)")
  expect(fsSource).toContain("write_export_file_decodes_base64_before_writing")
  const exportImplementation = fsSource.slice(
    fsSource.indexOf("fn do_write_export_file_with_replace"),
    fsSource.indexOf("const MAX_EXPORT_BYTES"),
  )
  expect(exportImplementation).not.toContain("resolve_project_storage_path")
  expect(fsSource).toContain("do_write_export_file_with_replace")
  expect(fsSource).toContain("replace_export_file_atomically")
  expect(fsSource).toContain("write_export_file_uses_dialog_path_without_project_path_rewrite")
  expect(fsSource).toContain("write_export_file_replace_failure_keeps_old_file_and_removes_temp_file")
  expect(fsSource).toContain("write_export_file_atomically_replaces_existing_file")
  expect(fsSource).toContain("MAX_EXPORT_BYTES")
  expect(fsSource).toContain("validate_export_base64_length")
  expect(fsSource).toContain("write_export_file_enforces_64_mib_boundary")
  expect(libSource).toContain("commands::fs::write_export_file")
  const serviceSource = readFileSync(resolve(process.cwd(), "src/lib/export-center/export-service.ts"), "utf8")
  expect(serviceSource).toContain("contentsBase64: encodeExportBytesBase64(bytes)")
})

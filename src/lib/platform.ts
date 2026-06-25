type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
}

export async function pickDirectory(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择文件夹",
    })
    return selected ?? null
  }

  if (supportsDirectoryPicker()) {
    try {
      const pickerWindow = window as DirectoryPickerWindow
      const handle = await pickerWindow.showDirectoryPicker?.()
      return handle?.name ?? null
    } catch (err) {
      if ((err as DOMException).name === "AbortError") {
        return null
      }
      throw err
    }
  }

  return window.prompt("请输入文件夹路径：")
}

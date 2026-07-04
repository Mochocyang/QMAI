type DiskSyncHandler = (path: string) => Promise<boolean>

let activeHandler: DiskSyncHandler | null = null

export function registerEditorDiskSyncHandler(handler: DiskSyncHandler | null): void {
  activeHandler = handler
}

export async function requestEditorDiskSyncIfSafe(path: string): Promise<boolean> {
  if (!activeHandler) return false
  return activeHandler(path)
}

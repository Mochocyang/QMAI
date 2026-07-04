export function hasUnsavedLocalEdits(input: {
  lastLoaded: string
  editorContent: string
  normalize?: (content: string) => string
  hasPendingSave?: boolean
}): boolean {
  const normalize = input.normalize ?? ((content) => content)
  return normalize(input.editorContent) !== normalize(input.lastLoaded) || Boolean(input.hasPendingSave)
}

/** True when disk changed on disk and it is safe to overwrite the editor from disk. */
export function shouldApplyDiskToEditor(input: {
  lastLoaded: string
  editorContent: string
  diskContent: string
  normalize?: (content: string) => string
  hasPendingSave?: boolean
}): boolean {
  if (hasUnsavedLocalEdits(input)) return false
  const normalize = input.normalize ?? ((content) => content)
  return normalize(input.diskContent) !== normalize(input.lastLoaded)
}

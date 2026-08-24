export function shouldHideNodeType(
  nodeType: string | undefined,
  hiddenTypes: ReadonlySet<string>,
): boolean {
  return nodeType !== undefined && hiddenTypes.has(nodeType)
}

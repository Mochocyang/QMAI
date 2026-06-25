export const APP_NAME = "青幕AI写作"

export function formatAppTitle(projectName: string | null | undefined): string {
  const name = projectName?.trim()
  return name ? `${APP_NAME}｜${name}` : APP_NAME
}

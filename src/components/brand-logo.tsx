interface BrandLogoProps {
  className?: string
  title?: string
}

/** 扁平单色标志：底色跟随 currentColor，任意配色下形状不变。 */
export function BrandLogo({ className, title }: BrandLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <rect width="64" height="64" rx="16" fill="currentColor" />
      <rect x="30" y="15" width="4" height="34" rx="2" fill="var(--qm-mark, #fff)" />
    </svg>
  )
}

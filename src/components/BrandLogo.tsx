import { brandLogoSrc, type ResolvedTheme } from '../lib/theme'

interface Props {
  resolvedTheme?: ResolvedTheme
  size?: number
  className?: string
}

/** 按落地主题切换 brand mark（dark→logo-light，light→logo-dark） */
export function BrandLogo({ resolvedTheme, size = 36, className }: Props) {
  const current =
    resolvedTheme ??
    ((typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light')
      ? 'light'
      : 'dark')
  return (
    <img
      src={brandLogoSrc(current)}
      alt=""
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  )
}

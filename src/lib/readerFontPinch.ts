export const READER_FONT_SCALE_MIN = 0.8
export const READER_FONT_SCALE_MAX = 1.4
export const READER_BASE_FONT_PX = 15.5

export function clampReaderFontScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(READER_FONT_SCALE_MAX, Math.max(READER_FONT_SCALE_MIN, value))
}

export function pinchFontScale(
  fromScale: number,
  fromDistance: number,
  distance: number,
): number {
  if (fromDistance <= 0 || !Number.isFinite(distance) || !Number.isFinite(fromScale)) {
    return clampReaderFontScale(fromScale)
  }
  return clampReaderFontScale(fromScale * (distance / fromDistance))
}

export function formatFontScaleHud(scale: number): string {
  return `字号 ${Math.round(clampReaderFontScale(scale) * 100)}%`
}

export function readerFontSizeCss(scale: number): string {
  return `${(READER_BASE_FONT_PX * clampReaderFontScale(scale)).toFixed(2)}px`
}

export function applyReaderFontSizeVar(scale: number): void {
  document.documentElement.style.setProperty('--reader-font-size', readerFontSizeCss(scale))
}

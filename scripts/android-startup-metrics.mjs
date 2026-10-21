/** Parse Android's independently reported first- and fully-drawn metrics. */
export function readStartupMetrics(log, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const activity = `${escaped}\\/(?:com\\.aizeek\\.newsnook)?\\.MainActivity`
  const duration = String.raw`\+(?:(\d+)s)?(\d+)ms`
  const displayed = log.match(new RegExp(`Displayed ${activity}[^\\n]*?${duration}`))
  const fullyDrawn = log.match(new RegExp(`Fully drawn ${activity}[^\\n]*?${duration}`))
  const nativeEvent = name => {
    const match = log.match(new RegExp(`NewsNookStartup[^\\n]*?${name}[^\\n]*?elapsed=(\\d+)ms`))
    return match ? Number(match[1]) : null
  }
  const ms = match => match ? Number(match[1] || 0) * 1000 + Number(match[2]) : null
  const start = nativeEvent('application-attachBaseContext')
  const commit = nativeEvent('__NNSTART first-app-commit')
  const frame = nativeEvent('__NNSTART first-ui-frame')
  return {
    ttidMs: ms(displayed),
    ttfdMs: ms(fullyDrawn),
    appCommitFromAttachMs: start === null || commit === null ? null : commit - start,
    frameFromAttachMs: start === null || frame === null ? null : frame - start,
  }
}

export function summarizeTimes(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return { n: sorted.length, median: sorted[Math.floor((sorted.length - 1) / 2)], p90: sorted[Math.ceil(sorted.length * 0.9) - 1] }
}

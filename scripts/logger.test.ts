import assert from 'node:assert/strict'

import { createLogger, logController } from '../src/lib/logger.ts'

function withMockConsole(run: () => void): string[] {
  const lines: string[] = []
  const capture =
    (tag: string) =>
    (...args: unknown[]) => {
      lines.push(`${tag}:${args.map(String).join(' ')}`)
    }
  const original = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    log: console.log,
  }
  console.error = capture('error')
  console.warn = capture('warn')
  console.info = capture('info')
  console.debug = capture('debug')
  console.log = capture('log')
  try {
    run()
  } finally {
    console.error = original.error
    console.warn = original.warn
    console.info = original.info
    console.debug = original.debug
    console.log = original.log
  }
  return lines
}

logController.reset()
logController.setLevel('debug')

const http = createLogger('http')

withMockConsole(() => {
  http.debug('request', { url: 'https://example.com' })
  http.warn('slow')
  logController.disable('http')
  http.debug('hidden')
  logController.enable('http')
  http.debug('visible again')
})

logController.setLevel('warn')
withMockConsole(() => {
  http.debug('dropped by level')
  http.warn('kept')
})

logController.setLevel('silent')
withMockConsole(() => {
  http.error('also silent')
  http.warn('also silent')
})

logController.reset()
logController.setConfig({
  level: 'trace',
  namespaces: { sniffer: false, boot: true },
})

const sniffer = createLogger('sniffer')
const boot = createLogger('boot')

withMockConsole(() => {
  sniffer.info('blocked')
  boot.info('allowed')
})

const cfg = logController.getConfig()
assert.equal(cfg.level, 'trace')
assert.equal(cfg.namespaces.sniffer, false)
assert.equal(cfg.namespaces.boot, true)

console.log('logger: ok')

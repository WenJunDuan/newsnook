#!/usr/bin/env node
/** Repeatable Activity cold-start TTID probe; React TTFD must be instrumented separately. */
import { spawnSync } from 'node:child_process'

const adb = process.env.ADB || 'adb'
const pkg = process.argv[2] || 'com.aizeek.newsnook.debug'
const iterations = Number(process.argv[3] || 10)
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error('iterations must be an integer between 1 and 100')
}
function run(...args) {
  const result = spawnSync(adb, args, { encoding: 'utf8', timeout: 60000 })
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || 'adb failed')
  return result.stdout
}
const times = []
for (let i = 0; i < iterations; i++) {
  run('shell', 'am', 'force-stop', pkg)
  const out = run('shell', 'am', 'start', '-W', '-n', `${pkg}/com.aizeek.newsnook.MainActivity`)
  const match = out.match(/TotalTime:\s*(\d+)/)
  if (!match) throw new Error(`No TotalTime reported: ${out}`)
  times.push(Number(match[1]))
  console.log(`${i + 1}/${iterations}: ${times.at(-1)} ms`)
}
const sorted = [...times].sort((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)]
const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1]
console.log(`Activity cold-start TTID proxy: n=${times.length}, median=${median} ms, p90=${p90} ms; does NOT measure React interactivity`)

import { useEffect, useRef, useState, type RefObject } from 'react'

import {
  applyReaderFontSizeVar,
  formatFontScaleHud,
  pinchFontScale,
} from '../lib/readerFontPinch'

const HUD_HOLD_MS = 1000

export interface UseReaderFontPinchOptions {
  targetRef: RefObject<HTMLElement | null>
  fontScale: number
  enabled: boolean
  onCommit: (next: number) => void
}

type Point = { x: number; y: number }

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function isExcludedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('[data-no-font-pinch], video'))
}

/**
 * Two-finger pinch on the reader scroll surface adjusts body font scale.
 * Preview updates CSS vars without writing prefs; commit runs on pinch end.
 */
export function useReaderFontPinch({
  targetRef,
  fontScale,
  enabled,
  onCommit,
}: UseReaderFontPinchOptions): { hudLabel: string | null; pinching: boolean } {
  const [hudLabel, setHudLabel] = useState<string | null>(null)
  const [pinching, setPinching] = useState(false)

  const fontScaleRef = useRef(fontScale)
  const onCommitRef = useRef(onCommit)
  const pointersRef = useRef(new Map<number, Point>())
  const startDistanceRef = useRef(0)
  const startScaleRef = useRef(fontScale)
  const previewRef = useRef<number | null>(null)
  const hudTimerRef = useRef(0)
  const pinchingRef = useRef(false)

  fontScaleRef.current = fontScale
  onCommitRef.current = onCommit

  useEffect(() => {
    if (!enabled) {
      pointersRef.current.clear()
      startDistanceRef.current = 0
      previewRef.current = null
      pinchingRef.current = false
      setPinching(false)
      if (hudTimerRef.current) {
        window.clearTimeout(hudTimerRef.current)
        hudTimerRef.current = 0
      }
      setHudLabel(null)
      return
    }

    const element = targetRef.current
    if (!element) return

    const endPinch = () => {
      if (!pinchingRef.current) return
      pinchingRef.current = false
      setPinching(false)
      const preview = previewRef.current
      previewRef.current = null
      startDistanceRef.current = 0
      if (preview != null && Math.abs(preview - fontScaleRef.current) > 0.001) {
        onCommitRef.current(preview)
      }
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current)
      hudTimerRef.current = window.setTimeout(() => {
        setHudLabel(null)
        hudTimerRef.current = 0
      }, HUD_HOLD_MS)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (isExcludedTarget(event.target)) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointersRef.current.size === 2) {
        if (hudTimerRef.current) {
          window.clearTimeout(hudTimerRef.current)
          hudTimerRef.current = 0
        }
        const [a, b] = [...pointersRef.current.values()]
        startDistanceRef.current = distance(a, b)
        startScaleRef.current = fontScaleRef.current
        previewRef.current = fontScaleRef.current
        pinchingRef.current = true
        setPinching(true)
        setHudLabel(formatFontScaleHud(fontScaleRef.current))
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!pinchingRef.current || pointersRef.current.size < 2) return
      if (event.cancelable) event.preventDefault()
      const [a, b] = [...pointersRef.current.values()]
      const next = pinchFontScale(
        startScaleRef.current,
        startDistanceRef.current,
        distance(a, b),
      )
      previewRef.current = next
      applyReaderFontSizeVar(next)
      setHudLabel(formatFontScaleHud(next))
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.delete(event.pointerId)
      if (pinchingRef.current && pointersRef.current.size < 2) {
        endPinch()
      }
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove, { passive: false })
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerUp)
    element.addEventListener('lostpointercapture', onPointerUp)

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerUp)
      element.removeEventListener('lostpointercapture', onPointerUp)
      if (hudTimerRef.current) {
        window.clearTimeout(hudTimerRef.current)
        hudTimerRef.current = 0
      }
      pointersRef.current.clear()
      pinchingRef.current = false
    }
  }, [enabled, targetRef])

  return { hudLabel, pinching }
}

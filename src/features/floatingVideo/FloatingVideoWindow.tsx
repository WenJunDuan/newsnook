import { useCallback, useEffect, useRef, useState, type RefObject, type PointerEvent } from 'react'
import { GripVertical, Maximize2, X } from 'lucide-react'
import { useWindowGesture } from './useWindowGesture'

const CHROME_IDLE_MS = 2600

/** Video-first, app-scoped floating player. The slot always retains the same media node. */
export function FloatingVideoWindow({ title, active, hidden, domFullscreen, slotRef, onRestore, onClose }: {
  title: string
  active: boolean
  hidden: boolean
  domFullscreen: boolean
  slotRef: RefObject<HTMLDivElement | null>
  onRestore: () => void
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { rect, drag, resize, pinch, tip, dismissTip } = useWindowGesture(rootRef, slotRef, hidden)
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeTimer = useRef<number | null>(null)

  const cancelChromeTimer = useCallback(() => {
    if (chromeTimer.current != null) window.clearTimeout(chromeTimer.current)
    chromeTimer.current = null
  }, [])

  const revealChrome = useCallback(() => {
    if (hidden) return
    cancelChromeTimer()
    setChromeVisible(true)
    if (slotRef.current?.querySelector('video')?.paused === false) {
      chromeTimer.current = window.setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS)
    }
  }, [cancelChromeTimer, hidden, slotRef])

  useEffect(() => {
    if (hidden) {
      cancelChromeTimer()
      return
    }
    const video = slotRef.current?.querySelector('video')
    if (!video) return
    const syncPlayback = () => {
      if (video.paused || video.ended) {
        cancelChromeTimer()
        setChromeVisible(true)
      } else {
        revealChrome()
      }
    }
    video.addEventListener('play', syncPlayback)
    video.addEventListener('pause', syncPlayback)
    video.addEventListener('ended', syncPlayback)
    syncPlayback()
    return () => {
      video.removeEventListener('play', syncPlayback)
      video.removeEventListener('pause', syncPlayback)
      video.removeEventListener('ended', syncPlayback)
      cancelChromeTimer()
    }
  }, [cancelChromeTimer, hidden, revealChrome, slotRef])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Preserve pinch-to-resize: showing controls must not capture the pointer.
    revealChrome()
    pinch.onPointerDownCapture(event)
  }

  return <div
    data-floating-video-window={active ? '' : undefined}
    data-floating-chrome={chromeVisible ? 'shown' : 'hidden'}
    data-floating-narrow={rect.width < 260 ? '' : undefined}
    aria-hidden={(hidden && !domFullscreen) || undefined}
    data-theme="dark"
    className="floating-video-window"
    ref={rootRef}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, visibility: hidden ? 'hidden' : undefined }}
    onPointerDownCapture={handlePointerDown}
    onPointerMoveCapture={pinch.onPointerMoveCapture}
    onPointerUpCapture={pinch.onPointerUpCapture}
    onPointerCancelCapture={pinch.onPointerCancelCapture}
    onPointerEnter={revealChrome}
    onFocusCapture={revealChrome}
  >
    <div ref={slotRef} className="floating-video-slot" />
    <div className="floating-video-idle-grip" aria-hidden="true" />
    <header className="floating-video-chrome">
      <div role="button" tabIndex={0} aria-label="移动悬浮窗口" title="拖动移动悬浮窗口" className="floating-video-drag" {...drag}>
        <GripVertical size={14} strokeWidth={1.7} aria-hidden="true" />
        <span>{title}</span>
      </div>
      <div className="floating-video-actions">
        <button type="button" aria-label="恢复播放页" title="恢复播放页" onClick={onRestore}><Maximize2 size={17} strokeWidth={1.8} /></button>
        <button type="button" aria-label="关闭悬浮播放" title="关闭" onClick={onClose}><X size={18} strokeWidth={1.8} /></button>
      </div>
    </header>
    <div role="button" tabIndex={0} aria-label="调整悬浮窗口大小" title="拖动调整窗口大小" className="floating-video-resize" {...resize}>
      <span aria-hidden="true" />
    </div>
    {tip && <button className="floating-video-tip" type="button" onClick={dismissTip}>左上拖动 · 右下缩放</button>}
  </div>
}

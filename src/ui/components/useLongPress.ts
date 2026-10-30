import { useRef } from 'react'

/**
 * Tap vs long-press on one element (plan §6): a press held 450 ms opens the inspector, cancelled
 * by 10 px of movement; a shorter press is the tap. Right-click (contextmenu) also inspects, and a
 * keyboard activation (a click with `detail` 0) is a tap, so zones stay plain buttons.
 */

export const LONG_PRESS_MS = 450
export const MOVE_CANCEL_PX = 10

export interface PressHandlers {
  onPointerDown(event: React.PointerEvent): void
  onPointerMove(event: React.PointerEvent): void
  onPointerUp(event: React.PointerEvent): void
  onPointerCancel(event: React.PointerEvent): void
  onPointerLeave(event: React.PointerEvent): void
  onContextMenu(event: React.MouseEvent): void
  onClick(event: React.MouseEvent): void
}

interface Press {
  timer: ReturnType<typeof setTimeout> | null
  x: number
  y: number
  longFired: boolean
}

export function useLongPress(onTap: () => void, onLongPress: () => void): PressHandlers {
  const press = useRef<Press | null>(null)

  const cancelTimer = (): void => {
    const current = press.current
    if (current?.timer != null) {
      clearTimeout(current.timer)
      current.timer = null
    }
  }

  return {
    onPointerDown: (event) => {
      cancelTimer()
      const current: Press = { timer: null, x: event.clientX, y: event.clientY, longFired: false }
      current.timer = setTimeout(() => {
        current.timer = null
        current.longFired = true
        onLongPress()
      }, LONG_PRESS_MS)
      press.current = current
    },
    onPointerMove: (event) => {
      const current = press.current
      if (current === null || current.timer === null) return
      const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y)
      if (moved > MOVE_CANCEL_PX) {
        // Moving cancels both the long-press and the tap: it reads as a scroll, not a bet.
        cancelTimer()
        press.current = null
      }
    },
    onPointerUp: () => {
      const current = press.current
      press.current = null
      if (current === null || current.longFired) return
      if (current.timer !== null) {
        clearTimeout(current.timer)
        onTap()
      }
    },
    onPointerCancel: () => {
      cancelTimer()
      press.current = null
    },
    onPointerLeave: () => {
      cancelTimer()
      press.current = null
    },
    onContextMenu: (event) => {
      event.preventDefault()
      onLongPress()
    },
    onClick: (event) => {
      // Keyboard activation only: pointer taps were handled on pointerup.
      if (event.detail === 0) onTap()
    },
  }
}

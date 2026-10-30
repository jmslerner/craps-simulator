import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * The app's modal dialog (plan §0 #19): a labelled `role="dialog"` that traps Tab inside itself,
 * closes on Escape and on the backdrop, and gives focus back to whatever opened it. On open, focus
 * lands on the element carrying `data-autofocus` (the New game dialog puts it on the checked
 * bankroll choice), else on the first focusable control.
 */

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function Dialog({
  titleId,
  onClose,
  children,
  className,
}: {
  /** The id of the heading that names the dialog. */
  titleId: string
  onClose(): void
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current
    const preferred = root?.querySelector<HTMLElement>('[data-autofocus]')
    const first = preferred ?? root?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    return () => {
      opener?.focus()
    }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const root = ref.current
    if (root === null) return
    const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose} data-testid="dialog-backdrop">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={className === undefined ? 'dialog' : `dialog ${className}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}

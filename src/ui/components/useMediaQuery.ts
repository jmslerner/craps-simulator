import { useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query matches, kept live (plan §0 #28: the Coach drawer docks open from
 * 1400 px; the prop tabs open a bottom sheet on phones). Where the host has no `matchMedia` (the
 * jsdom unit tests) or it throws, the answer is `fallback`, so a component renders its wide-screen
 * form there.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = mediaList(query)
      if (list === null) return () => undefined
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => mediaList(query)?.matches ?? fallback,
    () => fallback,
  )
}

/** The viewport widths the layout switches at (index.css keeps the same numbers). */
export const DOCKED_DRAWER_QUERY = '(min-width: 1400px)'
export const PHONE_QUERY = '(max-width: 599px)'

function mediaList(query: string): MediaQueryList | null {
  if (typeof matchMedia !== 'function') return null
  try {
    return matchMedia(query)
  } catch {
    return null
  }
}

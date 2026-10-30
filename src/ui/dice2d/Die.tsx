import type { Die as DieFace } from '../../engine/index.ts'

/**
 * One die face as a 3×3 pip grid, shared by the dome slot, the roll history, the machine's history
 * strip and the hop buttons' dice pictures. Pure markup: the pips are positioned by CSS (`.die` in
 * index.css), and the face is announced through the parent's label, so the grid itself is
 * presentational. `variant="white"` draws the station's white die with black pips.
 */

const PIPS: Readonly<Record<DieFace, readonly number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

export function Die({
  face,
  small = false,
  variant = 'red',
}: {
  face: DieFace
  small?: boolean
  variant?: 'red' | 'white'
}) {
  const pips = PIPS[face]
  const classes = ['die', small ? 'die-small' : '', variant === 'white' ? 'die-white' : '']
    .filter((name) => name !== '')
    .join(' ')
  return (
    <span className={classes} data-face={face} aria-hidden="true">
      {Array.from({ length: 9 }, (_unused, cell) => (
        <span key={cell} className={pips.includes(cell) ? 'pip' : 'pip pip-off'} />
      ))}
    </span>
  )
}

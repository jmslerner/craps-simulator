import type { Die as DieFace } from '../../engine/index.ts'

/**
 * One die face as a 3×3 pip grid, shared by the dome slot and the roll history. Pure markup: the
 * pips are positioned by CSS (`.die` in index.css), and the face is announced through the parent's
 * label, so the grid itself is presentational.
 */

const PIPS: Readonly<Record<DieFace, readonly number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

export function Die({ face, small = false }: { face: DieFace; small?: boolean }) {
  const pips = PIPS[face]
  return (
    <span className={small ? 'die die-small' : 'die'} data-face={face} aria-hidden="true">
      {Array.from({ length: 9 }, (_unused, cell) => (
        <span key={cell} className={pips.includes(cell) ? 'pip' : 'pip pip-off'} />
      ))}
    </span>
  )
}

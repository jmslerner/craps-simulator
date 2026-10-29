/**
 * Face remap (§7). The physics decides where a die's body ends up; the offset o decides which pip
 * face is drawn on each body face. Face `target` shows on top when R[o]·n_target = a_up, where
 * a_up is the body-local axis pointing up at rest.
 */
import { CUBE_ROTATIONS, FACE_AXIS, rotationAngleDeg, type AxisIndex, type DieFace } from './cube.ts'

/** Every offset that puts `target` on top of a body whose up axis is `aUp`: always exactly 4. */
export function remapCandidates(aUp: AxisIndex, target: DieFace): number[] {
  const from = FACE_AXIS[target]
  const candidates: number[] = []
  CUBE_ROTATIONS.forEach((rotation, index) => {
    if (rotation.axisMap[from] === aUp) candidates.push(index)
  })
  return candidates
}

/**
 * Chooses o_end: of the 4 candidates, the one with the smallest rotation from `oStart`, the
 * previous rest offset, so the drawn die changes as little as possible. Ties go to the lowest
 * index, which keeps plans deterministic.
 */
export function chooseEndOffset(aUp: AxisIndex, target: DieFace, oStart: number): number {
  let best = -1
  let bestAngle = Infinity
  for (const candidate of remapCandidates(aUp, target)) {
    const angle = rotationAngleDeg(oStart, candidate)
    if (angle < bestAngle) {
      best = candidate
      bestAngle = angle
    }
  }
  return best
}

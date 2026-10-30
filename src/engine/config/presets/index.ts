import type { MachineConfigInput } from '../schema.ts'
import { craplessBubble } from './craplessBubble.ts'
import { craplessBubbleHighLimit } from './craplessBubbleHighLimit.ts'
import { strictBubble } from './strictBubble.ts'
import { traditionalBubble } from './traditionalBubble.ts'
import { traditionalLive345 } from './traditionalLive345.ts'

export {
  craplessBubble,
  craplessBubbleHighLimit,
  strictBubble,
  traditionalBubble,
  traditionalLive345,
}

/**
 * The built-in machines (rules spec §5.2), each frozen and tagged with provenance. Crapless is the
 * default: it models the Interblock heads-up crapless machines the trainer is built for. The
 * high-limit variant is the same machine at researched Las Vegas high-limit stakes
 * (docs/rules/research/high-limit-machines.md).
 */
export const PRESETS = Object.freeze({
  craplessBubble,
  craplessBubbleHighLimit,
  traditionalBubble,
  strictBubble,
  traditionalLive345,
} satisfies Record<string, MachineConfigInput>)

export type PresetId = keyof typeof PRESETS

export const PRESET_IDS: readonly PresetId[] = Object.freeze([
  'craplessBubble',
  'craplessBubbleHighLimit',
  'traditionalBubble',
  'strictBubble',
  'traditionalLive345',
])

export const DEFAULT_PRESET_ID: PresetId = 'craplessBubble'

export function isPresetId(value: string): value is PresetId {
  return (PRESET_IDS as readonly string[]).includes(value)
}

import { useStore } from 'zustand'
import type { DiceDomeController } from './domeController.ts'
import { isQualityChoice, TIER_ORDER } from './quality.ts'
import './dome.css'

/**
 * The player's quality pin (plan §7 Quality, M10b): a select in the dome's corner over the
 * controller's quality store. Auto follows the device class and the frame-time monitor and shows
 * the tier that gives; a pinned tier turns the monitor off. Shown only while WebGL works, since
 * it has nothing to set otherwise.
 */

const LABELS: Readonly<Record<(typeof TIER_ORDER)[number], string>> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function QualityControl({ controller }: { controller: DiceDomeController }) {
  const webgl = useStore(controller.store, (snapshot) => snapshot.webgl)
  const override = useStore(controller.quality, (quality) => quality.override)
  const tier = useStore(controller.quality, (quality) => quality.tier)
  if (webgl !== 'ok') return null
  return (
    <select
      className="dome-quality"
      aria-label="3D quality"
      title="3D quality: auto picks a tier for this device and lowers it when frames run slow"
      value={override}
      onChange={(event) => {
        const choice = event.target.value
        if (isQualityChoice(choice)) controller.quality.getState().setOverride(choice)
      }}
    >
      <option value="auto">Auto ({LABELS[tier]})</option>
      {TIER_ORDER.map((option) => (
        <option key={option} value={option}>
          {LABELS[option]}
        </option>
      ))}
    </select>
  )
}

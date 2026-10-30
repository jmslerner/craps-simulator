import { useEffect } from 'react'
import type { MachineConfigInput, PresetId } from '../../../engine/index.ts'
import { FilesPanel } from './FilesPanel.tsx'
import { MachineEditor } from './MachineEditor.tsx'
import { MatchMyMachine } from './MatchMyMachine.tsx'

/**
 * The New game dialog's machine views (M12) in one module, which the dialog loads only when the
 * player opens one: the machine editor, Match My Machine and the files panel never weigh on the
 * first paint of the table.
 */

export type EditorView =
  | {
      readonly kind: 'edit'
      readonly initial: MachineConfigInput
      readonly base: MachineConfigInput | null
      readonly baseName: string | null
      onSave(config: MachineConfigInput): Promise<string | null>
    }
  | {
      readonly kind: 'match'
      readonly prefer: PresetId | null
      onReview(input: MachineConfigInput, base: PresetId): void
    }
  | {
      readonly kind: 'files'
      onGameLoaded(message: string): void
      onMachines(ids: readonly string[]): void
    }

export default function EditorViews({
  view,
  onBack,
}: {
  readonly view: EditorView
  onBack(): void
}) {
  // Each view opens with focus on its heading, so a screen reader announces where it is.
  useEffect(() => {
    document.getElementById('new-game-title')?.focus()
  }, [view.kind])
  switch (view.kind) {
    case 'edit':
      return (
        <MachineEditor
          initial={view.initial}
          base={view.base}
          baseName={view.baseName}
          onSave={view.onSave}
          onCancel={onBack}
        />
      )
    case 'match':
      return <MatchMyMachine prefer={view.prefer} onReview={view.onReview} onBack={onBack} />
    case 'files':
      return (
        <FilesPanel onGameLoaded={view.onGameLoaded} onMachines={view.onMachines} onBack={onBack} />
      )
  }
}

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PRESETS } from '../../../engine/index.ts'
import type { MachineConfigInput } from '../../../engine/index.ts'
import { MachineEditor, fieldId } from './MachineEditor.tsx'

/**
 * The machine editor (plan §10 M12): inline config errors at their fields, provenance chips on
 * every field, and the sanity gate — "place 6 pays 7:5" blocks saving, an edge above 40% warns,
 * 2/12 odds at 11:2 are flagged "not free" at 7.14% — every figure from src/exact.
 */

function editor(base = PRESETS.craplessBubble) {
  const initial = { ...structuredClone(base), id: 'my-test', name: 'My test' } as MachineConfigInput
  const onSave = vi.fn(async (config: MachineConfigInput) => {
    void config
    return null
  })
  const onCancel = vi.fn()
  const view = render(
    <MachineEditor
      initial={initial}
      base={base}
      baseName={base.name}
      onSave={onSave}
      onCancel={onCancel}
    />,
  )
  const input = (pointer: string): HTMLInputElement => {
    const element = view.container.querySelector<HTMLInputElement>(`#${fieldId(pointer)}`)
    if (element === null) throw new Error(`no input for ${pointer}`)
    return element
  }
  const field = (pointer: string): HTMLElement => {
    const element = view.container.querySelector<HTMLElement>(`[data-pointer="${pointer}"]`)
    if (element === null) throw new Error(`no field at ${pointer}`)
    return element
  }
  const openSection = (title: string) =>
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}`) }))
  const status = () => screen.getByTestId('editor-status')
  const save = () => screen.getByRole('button', { name: 'Save machine' })
  return { ...view, input, field, openSection, status, save, onSave, onCancel }
}

/** Waits for the sanity check to finish clean; generous, as it solves every bet of the machine. */
async function ready(status: () => HTMLElement): Promise<void> {
  await waitFor(() => expect(status()).toHaveTextContent(/ready to save/i), { timeout: 15_000 })
}

describe('the machine editor', { timeout: 30_000 }, () => {
  it('checks every bet of an unchanged machine and lets it be saved', async () => {
    const { status, save } = editor()
    expect(status()).toHaveTextContent(/Checking every bet/)
    expect(save()).toBeDisabled()
    await ready(status)
    expect(status()).toHaveTextContent('Every bet checks out: ready to save.')
    expect(save()).toBeEnabled()
  })

  it('shows a provenance chip on every field, assumed ones included, and marks the player’s own', async () => {
    const { container, openSection, input, field } = editor()
    openSection('Place')
    const chips = container.querySelectorAll('[data-chip]')
    expect(chips.length).toBeGreaterThan(20)
    expect(container.querySelectorAll('[data-chip="assumed"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-chip="verified"]').length).toBeGreaterThan(0)
    // Place 6's pay is assumed (the Interblock par sheet is not public).
    expect(within(field('/catalog/place/pays/6')).getByText('assumed')).toBeInTheDocument()
    fireEvent.change(input('/catalog/place/pays/6'), { target: { value: '7 to 6' } })
    expect(within(field('/catalog/place/pays/6')).getByText('yours')).toBeInTheDocument()
    // Back to the machine's own wording: the research is the source again.
    fireEvent.change(input('/catalog/place/pays/6'), { target: { value: '7:6' } })
    expect(within(field('/catalog/place/pays/6')).getByText('assumed')).toBeInTheDocument()
  })

  it('shows a zod error inline at the field, and nothing can be saved', async () => {
    const { openSection, input, field, status, save } = editor()
    await ready(status)
    openSection('Place')
    fireEvent.change(input('/catalog/place/pays/6'), { target: { value: 'seven to six' } })
    expect(
      within(field('/catalog/place/pays/6')).getByText(/Invalid ratio "seven to six"/),
    ).toBeInTheDocument()
    expect(input('/catalog/place/pays/6')).toHaveAttribute('aria-invalid', 'true')
    expect(status()).toHaveTextContent('1 problem to fix before saving.')
    expect(save()).toBeDisabled()
  })

  it('blocks the player-advantage edit "place 6 pays 7:5", with its computed edge', async () => {
    const { openSection, input, field, status, save } = editor()
    await ready(status)
    openSection('Place')
    fireEvent.change(input('/catalog/place/pays/6'), { target: { value: '7:5' } })
    await waitFor(() => expect(status()).toHaveTextContent('1 problem to fix before saving.'), {
      timeout: 15_000,
    })
    const message = within(field('/catalog/place/pays/6')).getByText(/favours the player/)
    expect(message).toHaveTextContent(
      'Place 6 favours the player: house edge -9.09% at $1.00. A casino never offers that',
    )
    expect(message).toHaveAttribute('data-issue', 'playerAdvantage')
    expect(save()).toBeDisabled()
  })

  it('flags 2/12 odds at 11:2 "not free" with their 7.14%, a warning that still saves', async () => {
    const { openSection, input, field, status, save } = editor()
    await ready(status)
    openSection('Pass Odds')
    fireEvent.change(input('/catalog/passOdds/pays/2'), { target: { value: '11:2' } })
    await waitFor(() => expect(status()).toHaveTextContent('Ready to save, with 1 warning.'), {
      timeout: 15_000,
    })
    const message = within(field('/catalog/passOdds/pays/2')).getByText(/not free/)
    expect(message).toHaveTextContent(
      'Pass Odds 2 is not free: odds that pay below true odds carry a house edge of 7.14%.',
    )
    expect(message).toHaveAttribute('data-issue', 'notFree')
    expect(save()).toBeEnabled()
  })

  it('warns about an edge above 40%', async () => {
    const { openSection, input, field, status, save } = editor()
    await ready(status)
    openSection('Seven')
    fireEvent.change(input('/catalog/any7/pays/7'), { target: { value: '2 for 1' } })
    await waitFor(() => expect(status()).toHaveTextContent(/Ready to save, with 1 warning/), {
      timeout: 15_000,
    })
    // A one-roll bet's warning shows on its pays, which every outcome shares.
    expect(
      within(field('/catalog/any7/pays')).getByText(/far above any real bet/),
    ).toHaveTextContent('house edge 66.67%')
    expect(save()).toBeEnabled()
  })

  it('shows the side-bet table warning inline: a table that pays less for more progress', async () => {
    const { openSection, input, container, status } = editor(PRESETS.traditionalLive345)
    await ready(status)
    openSection('Side bet: Fire Bet')
    fireEvent.change(input('/sideBets/fire/payTable/6'), { target: { value: '9 to 1' } })
    await waitFor(() => expect(status()).toHaveTextContent(/warning/), { timeout: 15_000 })
    const table = container.querySelector('[data-pointer="/sideBets/fire/payTable"]')
    expect(table?.querySelector('[data-issue="payDrops"]')).toHaveTextContent(
      'Fire Bet pays less for more progress',
    )
  })

  it('adds and removes optional values, recording them as the player’s', async () => {
    const { openSection, container, input, status } = editor()
    await ready(status)
    openSection('Money and limits')
    fireEvent.click(screen.getByRole('button', { name: 'Add table maximum' }))
    expect(input('/limits/tableMax')).toHaveValue('1')
    fireEvent.change(input('/limits/tableMax'), { target: { value: '2000' } })
    expect(
      container.querySelector('[data-pointer="/limits/tableMax"] [data-chip]'),
    ).toHaveTextContent('yours')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Table maximum' }))
    expect(container.querySelector(`#${fieldId('/limits/tableMax')}`)).toBeNull()
  })

  it('refuses dollars it cannot read without committing them', async () => {
    const { openSection, input, status } = editor()
    await ready(status)
    openSection('Money and limits')
    fireEvent.change(input('/limits/min'), { target: { value: 'five' } })
    expect(screen.getByText('Enter dollars, like 5 or 2.50.')).toBeInTheDocument()
    expect(status()).toHaveTextContent(/ready to save/i)
  })

  it('saves the draft it shows', async () => {
    const { openSection, input, status, save, onSave } = editor()
    await ready(status)
    openSection('Field')
    fireEvent.change(input('/catalog/field/pays/12'), { target: { value: '3:1' } })
    await ready(status)
    await act(async () => {
      fireEvent.click(save())
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0]?.[0]
    const field = saved?.catalog['field']
    expect(field?.family === 'oneRoll' && field.pays['12']).toBe('3:1')
    expect(saved?.provenance['/catalog/field/pays/12']?.source).toBe('USER')
  })
})

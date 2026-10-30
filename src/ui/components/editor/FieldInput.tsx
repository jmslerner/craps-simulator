import { useState } from 'react'
import { cents, formatCents, parseDollars } from '../../../engine/index.ts'
import type { FieldNode, Widget } from './fields.ts'

/**
 * One editor field's input (M12), by widget. Text-like inputs keep what the player is typing and
 * commit each value that reads: dollars must be whole cents, counts whole numbers, a list a comma
 * list; a pay ratio is committed as typed, for the config schema to judge. What does not read is
 * flagged here and left uncommitted, so the draft only ever holds values of the right type.
 */

export interface FieldInputProps {
  readonly node: FieldNode
  readonly id: string
  /** The ids of the messages that describe the field, for `aria-describedby`. */
  readonly describedBy: string | undefined
  readonly invalid: boolean
  /** Commits a value; undefined removes it (an optional record key left empty). */
  onCommit(value: unknown): void
}

/** Dollars as the input shows them: "5", "5.25", "0.01". */
export function dollarsText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return ''
  return formatCents(cents(value), { trimWholeDollars: true }).replace('$', '').replaceAll(',', '')
}

type Parsed =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }

/** What the text in an input commits, for each widget that takes text. */
export function parseText(widget: Widget, text: string, clearable: boolean): Parsed {
  const trimmed = text.trim()
  const empty = trimmed === ''
  switch (widget.kind) {
    case 'money': {
      if (empty) return emptyValue(clearable, widget.nullable)
      try {
        return { ok: true, value: parseDollars(trimmed.replace(/^\$/, '')) }
      } catch {
        return { ok: false, error: 'Enter dollars, like 5 or 2.50.' }
      }
    }
    case 'integer': {
      if (empty) return emptyValue(clearable, widget.nullable)
      if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
        return { ok: false, error: 'Enter a whole number.' }
      }
      return { ok: true, value: Number(trimmed) }
    }
    case 'ratio':
    case 'text':
      if (empty && clearable) return { ok: true, value: undefined }
      return { ok: true, value: widget.kind === 'ratio' ? trimmed : text }
    case 'list': {
      const items = trimmed === '' ? [] : trimmed.split(',').map((item) => item.trim())
      if (items.some((item) => item === ''))
        return { ok: false, error: 'Separate items with commas.' }
      if (!widget.numeric) return { ok: true, value: items }
      const values: number[] = []
      for (const item of items) {
        const parsed = parseText(
          widget.money ? { kind: 'money', nullable: false } : { kind: 'integer', nullable: false },
          item,
          false,
        )
        if (!parsed.ok) return parsed
        values.push(parsed.value as number)
      }
      return { ok: true, value: values }
    }
    case 'boolean':
    case 'choice':
    case 'fixed':
    case 'set':
      return { ok: true, value: text }
  }
}

function emptyValue(clearable: boolean, nullable: boolean): Parsed {
  if (clearable) return { ok: true, value: undefined }
  if (nullable) return { ok: true, value: null }
  return { ok: false, error: 'Enter a value.' }
}

/** The text an input shows for a committed value. */
export function textOf(widget: Widget, value: unknown): string {
  if (value === undefined || value === null) return ''
  switch (widget.kind) {
    case 'money':
      return dollarsText(value)
    case 'list':
      return Array.isArray(value)
        ? value.map((item) => (widget.money ? dollarsText(item) : String(item))).join(', ')
        : ''
    case 'integer':
    case 'ratio':
    case 'text':
    case 'boolean':
    case 'choice':
    case 'fixed':
    case 'set':
      return String(value)
  }
}

export function FieldInput({ node, id, describedBy, invalid, onCommit }: FieldInputProps) {
  const { widget, value, clearable } = node
  switch (widget.kind) {
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          className="ed-check"
          checked={value === true}
          aria-describedby={describedBy}
          onChange={(event) => onCommit(event.target.checked)}
        />
      )
    case 'choice':
      return (
        <select
          id={id}
          className="ed-select"
          value={JSON.stringify(value ?? null)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onCommit(JSON.parse(event.target.value) as unknown)}
        >
          {widget.options.map((option) => (
            <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      )
    case 'fixed':
      return (
        <output
          id={id}
          className="ed-fixed"
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy}
        >
          {String(value)}
        </output>
      )
    case 'set': {
      const chosen = Array.isArray(value) ? (value as unknown[]) : []
      return (
        <span
          id={id}
          role="group"
          className="ed-set"
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy}
        >
          {widget.options.map((option) => (
            <label key={String(option)} className="ed-set-item">
              <input
                type="checkbox"
                checked={chosen.includes(option)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? widget.options.filter((o) => o === option || chosen.includes(o))
                    : chosen.filter((o) => o !== option)
                  onCommit(next)
                }}
              />
              {String(option)}
            </label>
          ))}
        </span>
      )
    }
    case 'money':
    case 'integer':
    case 'ratio':
    case 'text':
    case 'list':
      return (
        <TextInput
          id={id}
          widget={widget}
          value={value}
          clearable={clearable}
          describedBy={describedBy}
          invalid={invalid}
          compact={node.compact}
          onCommit={onCommit}
        />
      )
  }
}

function TextInput({
  id,
  widget,
  value,
  clearable,
  describedBy,
  invalid,
  compact,
  onCommit,
}: {
  readonly id: string
  readonly widget: Widget
  readonly value: unknown
  readonly clearable: boolean
  readonly describedBy: string | undefined
  readonly invalid: boolean
  readonly compact: boolean
  onCommit(value: unknown): void
}) {
  const shown = textOf(widget, value)
  const [text, setText] = useState(shown)
  const [error, setError] = useState<string | null>(null)
  const [lastShown, setLastShown] = useState(shown)
  // A value changed from outside (a reset, another field's add) replaces what the input shows,
  // unless the text already reads as that value: "2.5" stays while the draft holds $2.50.
  if (shown !== lastShown) {
    setLastShown(shown)
    const parsed = parseText(widget, text, clearable)
    if (!(parsed.ok && textOf(widget, parsed.value) === shown)) {
      setText(shown)
      setError(null)
    }
  }
  const errorId = `${id}-input-error`
  const money = widget.kind === 'money' || (widget.kind === 'list' && widget.money)
  return (
    <span className={`ed-text${compact ? ' ed-text-compact' : ''}`}>
      {money && <span aria-hidden="true">$</span>}
      <input
        id={id}
        type="text"
        inputMode={widget.kind === 'integer' || widget.kind === 'money' ? 'decimal' : undefined}
        value={text}
        aria-invalid={invalid || error !== null || undefined}
        aria-describedby={
          [describedBy, error === null ? undefined : errorId].filter(Boolean).join(' ') || undefined
        }
        onChange={(event) => {
          setText(event.target.value)
          const parsed = parseText(widget, event.target.value, clearable)
          if (parsed.ok) {
            setError(null)
            onCommit(parsed.value)
          } else {
            setError(parsed.error)
          }
        }}
      />
      {error !== null && (
        <span id={errorId} className="ed-input-error" role="alert">
          {error}
        </span>
      )}
    </span>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { compileConfig, validateConfig } from '../../../engine/index.ts'
import type { MachineConfig, MachineConfigInput } from '../../../engine/index.ts'
import type { ConfigIssue } from '../../../engine/config/issues.ts'
import type { SanityIssue } from '../../../exact/index.ts'
import { formatPart } from '../../../coach/format.ts'
import { exportFileName, machineFileText } from '../../../persistence/exchange.ts'
import { editValue, issuePointer, placeIssues, provenanceAt, type Path } from './draft.ts'
import {
  editorSections,
  sectionOf,
  shownPointers,
  type EditorNode,
  type FieldNode,
  type GroupNode,
  type Section,
} from './fields.ts'
import { FieldInput } from './FieldInput.tsx'
import { lineText, sanityLine, sanityPointer, type IssueLine } from './issueText.ts'
import { blocks, cachedSanity, runSanity, type SanityProgress } from './sanityRunner.ts'
import { downloadText } from './session.ts'
import './editor.css'

/**
 * The machine editor (plan §10 M12): every value of a machine config, in sections a player can
 * scan, each field with its provenance chip — verified, reported, assumed, or "yours" for a value
 * the player set — and its problems shown where they are:
 *
 * - **Inline config errors**: the schema and the semantic checks (`validateConfig`) run on the
 *   whole draft at every change, and each issue shows at its field (or the group that holds it,
 *   for a value the machine lacks).
 * - **Sanity gating**: once the draft is a valid config, `checkBet` (src/exact) prices every bet;
 *   a bet that favours the player ("place 6 pays 7:5") or is dead even blocks saving, an edge over
 *   40%, odds that are not free and a side-bet table that pays less for more progress warn. Every
 *   figure shown is a `CoachNumber` from that check.
 *
 * Saving is enabled only when nothing blocks it; warnings stay visible but never stop a machine
 * the player says is real.
 */

export interface MachineEditorProps {
  readonly initial: MachineConfigInput
  /** The machine it started from: a value set back to it gets its provenance back. */
  readonly base: MachineConfigInput | null
  readonly baseName: string | null
  /** Saves the machine; resolves with an error to show, or null when it was saved. */
  onSave(config: MachineConfigInput): Promise<string | null>
  onCancel(): void
}

/** A DOM id for a config pointer: every character outside [A-Za-z0-9] escaped. */
export function fieldId(pointer: string): string {
  return `ed${pointer.replace(/[^A-Za-z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`
}

interface Placed {
  readonly config: ReadonlyMap<string, readonly ConfigIssue[]>
  readonly sanity: ReadonlyMap<string, readonly IssueLine[]>
}

interface Context {
  readonly draft: MachineConfigInput
  readonly placed: Placed
  commit(path: Path, value: unknown): void
}

function compiled(draft: MachineConfigInput): MachineConfig | null {
  try {
    return compileConfig(draft)
  } catch {
    return null
  }
}

export function MachineEditor({ initial, base, baseName, onSave, onCancel }: MachineEditorProps) {
  const [draft, setDraft] = useState(initial)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(['machine']))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [sanity, setSanity] = useState<{
    readonly hash: string
    readonly issues: readonly SanityIssue[]
  } | null>(null)
  const [progress, setProgress] = useState<SanityProgress | null>(null)

  const sections = useMemo(() => editorSections(draft), [draft])
  const shown = useMemo(() => shownPointers(sections), [sections])
  const configIssues = useMemo(() => validateConfig(draft), [draft])
  // A config that validates compiles; `compiled` still guards a throw from deep inside one.
  const cfg = useMemo(
    () => (configIssues.length === 0 ? compiled(draft) : null),
    [configIssues, draft],
  )
  const sanityIssues =
    cfg === null ? null : sanity?.hash === cfg.configHash ? sanity.issues : cachedSanity(cfg)
  const checking = cfg !== null && sanityIssues === null

  useEffect(() => {
    if (cfg === null || cachedSanity(cfg) !== null) return
    const controller = new AbortController()
    // A short pause first: typing a pay runs one check, at the end, not one a keystroke.
    const timer = setTimeout(() => {
      void runSanity(cfg, controller.signal, (step) => {
        if (!controller.signal.aborted) setProgress(step)
      }).then((issues) => {
        if (issues !== null) setSanity({ hash: cfg.configHash, issues })
      })
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [cfg])

  const lines = useMemo(
    () =>
      cfg === null || sanityIssues === null
        ? []
        : sanityIssues.map((issue) => ({
            issue,
            line: sanityLine(issue, cfg, draft),
            pointer: sanityPointer(issue, draft),
          })),
    [cfg, sanityIssues, draft],
  )
  const placed: Placed = useMemo(
    () => ({
      config: placeIssues(configIssues, issuePointer, shown),
      sanity: new Map(
        [...placeIssues(lines, (entry) => entry.pointer, shown)].map(([pointer, entries]) => [
          pointer,
          entries.map((entry) => entry.line),
        ]),
      ),
    }),
    [configIssues, lines, shown],
  )

  const commit = useCallback(
    (path: Path, value: unknown) => {
      setSaveError(null)
      setDraft((current) => editValue(current, base, path, value))
    },
    [base],
  )

  const errors =
    configIssues.length + lines.filter((entry) => entry.line.severity === 'error').length
  const warnings = lines.filter((entry) => entry.line.severity === 'warning').length
  const blocked =
    configIssues.length > 0 || checking || (sanityIssues !== null && blocks(sanityIssues))

  const show = (pointer: string): void => {
    const section = sectionOf(sections, pointer)
    if (section !== undefined) setOpen((current) => new Set([...current, section.id]))
    // After the section renders, bring the field (or its group) into view and focus it.
    setTimeout(() => {
      let at = pointer
      for (;;) {
        const element = document.getElementById(fieldId(at))
        if (element !== null) {
          element.scrollIntoView?.({ block: 'center' })
          if (element instanceof HTMLElement) element.focus({ preventScroll: true })
          return
        }
        if (at === '') return
        at = at.slice(0, at.lastIndexOf('/'))
      }
    }, 0)
  }

  const save = async (): Promise<void> => {
    if (blocked) return
    setSaving(true)
    const error = await onSave(draft)
    setSaving(false)
    setSaveError(error)
  }

  const context: Context = { draft, placed, commit }
  const summary = [
    ...configIssues.map((issue) => ({
      key: `c${issuePointer(issue)}${issue.message}`,
      severity: 'error' as const,
      pointer: issuePointer(issue),
      text: `${issuePointer(issue) || '/'}: ${issue.message}`,
    })),
    ...lines.map((entry, index) => ({
      key: `s${index}`,
      severity: entry.line.severity,
      pointer: entry.pointer,
      text: lineText(entry.line),
    })),
  ]

  return (
    <div className="ed" data-testid="machine-editor">
      <h2 id="new-game-title" className="dialog-title" tabIndex={-1}>
        Machine editor
      </h2>
      <p className="ed-intro">
        {baseName === null ? 'Your machine' : `From ${baseName}`}. Every value shows where it comes
        from: <ChipLegend />
      </p>
      <div
        className={`ed-status${blocked ? ' is-blocked' : ''}`}
        role="status"
        data-testid="editor-status"
        data-blocked={blocked || undefined}
      >
        {configIssues.length > 0
          ? `${pluralize(errors, 'problem')} to fix before saving.`
          : checking
            ? `Checking every bet${progress === null ? '' : ` (${progress.checked} of ${progress.total})`}…`
            : errors > 0
              ? `${pluralize(errors, 'problem')} to fix before saving.`
              : warnings > 0
                ? `Ready to save, with ${pluralize(warnings, 'warning')}.`
                : 'Every bet checks out: ready to save.'}
      </div>
      {summary.length > 0 && (
        <ul className="ed-summary" data-testid="editor-issues">
          {summary.map((item) => (
            <li key={item.key} className={`ed-msg ed-msg-${item.severity}`}>
              <span>{item.text}</span>{' '}
              <button type="button" className="ed-link" onClick={() => show(item.pointer)}>
                Show
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ed-sections">
        {sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            open={open.has(section.id)}
            onToggle={() =>
              setOpen((current) => {
                const next = new Set(current)
                if (next.has(section.id)) next.delete(section.id)
                else next.add(section.id)
                return next
              })
            }
            context={context}
          />
        ))}
      </div>
      {saveError !== null && (
        <p className="dialog-error" role="alert">
          {saveError}
        </p>
      )}
      <div className="dialog-buttons ed-buttons">
        <button
          type="button"
          onClick={() =>
            downloadText(exportFileName('machine', draft.id), machineFileText([draft]))
          }
          disabled={configIssues.length > 0}
        >
          Download this machine
        </button>
        <button type="button" onClick={onCancel}>
          Back
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={blocked || saving}
          onClick={() => void save()}
        >
          Save machine
        </button>
      </div>
    </div>
  )
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function ChipLegend() {
  return (
    <span className="ed-legend">
      <span className="ed-chip ed-chip-verified">verified</span>{' '}
      <span className="ed-chip ed-chip-reported">reported</span>{' '}
      <span className="ed-chip ed-chip-assumed">assumed</span>{' '}
      <span className="ed-chip ed-chip-mine">yours</span>
    </span>
  )
}

function Chip({
  draft,
  pointer,
  compact,
}: {
  readonly draft: MachineConfigInput
  readonly pointer: string
  readonly compact: boolean
}) {
  const { status, entry, mine } = provenanceAt(draft, pointer)
  const word = mine ? 'yours' : status
  const title = [mine ? 'set by you' : status, entry?.source, entry?.note]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ')
  return (
    <span className={`ed-chip ed-chip-${mine ? 'mine' : status}`} title={title} data-chip={word}>
      {compact ? (
        <>
          <span aria-hidden="true">{word.charAt(0).toUpperCase()}</span>
          <span className="sr-only">{word}</span>
        </>
      ) : (
        word
      )}
    </span>
  )
}

function SectionView({
  section,
  open,
  onToggle,
  context,
}: {
  readonly section: Section
  readonly open: boolean
  onToggle(): void
  readonly context: Context
}) {
  const count = (map: ReadonlyMap<string, readonly unknown[]>) =>
    [...map]
      .filter(([pointer]) => sectionContains(section, pointer))
      .reduce((n, [, list]) => n + list.length, 0)
  const problems = count(context.placed.config) + count(context.placed.sanity)
  const own = section.pointer === null ? [] : (context.placed.sanity.get(section.pointer) ?? [])
  const ownConfig =
    section.pointer === null ? [] : (context.placed.config.get(section.pointer) ?? [])
  const bodyId = `ed-section-${section.id.replace(/[^A-Za-z0-9]/g, '-')}`
  return (
    <section
      className={`ed-section${problems > 0 ? ' has-issues' : ''}`}
      data-section={section.id}
      id={section.pointer === null ? undefined : fieldId(section.pointer)}
      tabIndex={section.pointer === null ? undefined : -1}
    >
      <h3 className="ed-section-title">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
        >
          <span>{section.title}</span>
          {problems > 0 && <span className="ed-badge">{problems}</span>}
        </button>
      </h3>
      {(own.length > 0 || ownConfig.length > 0) && (
        <Messages config={ownConfig} sanity={own} id={`${bodyId}-messages`} />
      )}
      {open && (
        <div id={bodyId} className="ed-section-body">
          {section.nodes.map((node) => (
            <NodeView key={node.pointer} node={node} context={context} />
          ))}
        </div>
      )}
    </section>
  )
}

function sectionContains(section: Section, pointer: string): boolean {
  const under = (root: string) => pointer === root || pointer.startsWith(`${root}/`)
  if (section.pointer !== null) return under(section.pointer)
  return section.nodes.some((node) => under(node.pointer))
}

function NodeView({ node, context }: { readonly node: EditorNode; readonly context: Context }) {
  return node.type === 'field' ? (
    <FieldRow node={node} context={context} />
  ) : (
    <GroupView node={node} context={context} />
  )
}

function Messages({
  config,
  sanity,
  id,
}: {
  readonly config: readonly ConfigIssue[]
  readonly sanity: readonly IssueLine[]
  readonly id: string
}) {
  if (config.length === 0 && sanity.length === 0) return null
  return (
    <ul id={id} className="ed-messages">
      {config.map((issue, index) => (
        <li key={`c${index}`} className="ed-msg ed-msg-error" data-issue="config">
          {issue.message}
        </li>
      ))}
      {sanity.map((line, index) => (
        <li key={`s${index}`} className={`ed-msg ed-msg-${line.severity}`} data-issue={line.code}>
          {line.parts.map((part) => formatPart(part)).join('')}
        </li>
      ))}
    </ul>
  )
}

function FieldRow({ node, context }: { readonly node: FieldNode; readonly context: Context }) {
  const id = fieldId(node.pointer)
  const config = context.placed.config.get(node.pointer) ?? []
  const sanity = context.placed.sanity.get(node.pointer) ?? []
  const messagesId = `${id}-messages`
  const hasMessages = config.length > 0 || sanity.length > 0
  const invalid = config.length > 0 || sanity.some((line) => line.severity === 'error')
  return (
    <div
      className={`ed-field${node.compact ? ' ed-cell' : ''}${invalid ? ' is-invalid' : ''}${
        hasMessages ? ' has-messages' : ''
      }`}
      data-pointer={node.pointer}
    >
      {node.widget.kind === 'set' || node.widget.kind === 'fixed' ? (
        <span id={`${id}-label`} className="ed-label">
          {node.label}
        </span>
      ) : (
        <label htmlFor={id} className="ed-label">
          {node.label}
        </label>
      )}
      <FieldInput
        node={node}
        id={id}
        describedBy={hasMessages ? messagesId : undefined}
        invalid={invalid}
        onCommit={(value) => context.commit(node.path, value)}
      />
      <Chip draft={context.draft} pointer={node.pointer} compact={node.compact} />
      {node.removable && (
        <button
          type="button"
          className="ed-remove"
          aria-label={`Remove ${node.label}`}
          onClick={() => context.commit(node.path, undefined)}
        >
          ×
        </button>
      )}
      <Messages config={config} sanity={sanity} id={messagesId} />
    </div>
  )
}

function GroupView({ node, context }: { readonly node: GroupNode; readonly context: Context }) {
  const id = fieldId(node.pointer)
  const config = context.placed.config.get(node.pointer) ?? []
  const sanity = context.placed.sanity.get(node.pointer) ?? []
  const { toggle } = node
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      className={`ed-group${node.grid ? ' ed-group-grid' : ''}`}
      data-pointer={node.pointer}
    >
      <legend className="ed-legend-row">
        <span className="ed-group-label">{node.label}</span>
        <Chip draft={context.draft} pointer={node.pointer} compact={false} />
        {toggle !== null && (
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={toggle.on}
              onChange={(event) =>
                context.commit(node.path, event.target.checked ? toggle.value : null)
              }
            />
            {toggle.on ? 'On' : 'Off'}
          </label>
        )}
        {node.removable && (
          <button
            type="button"
            className="ed-remove"
            aria-label={`Remove ${node.label}`}
            onClick={() => context.commit(node.path, undefined)}
          >
            ×
          </button>
        )}
      </legend>
      <Messages config={config} sanity={sanity} id={`${id}-messages`} />
      <div className={node.grid ? 'ed-grid' : 'ed-group-body'}>
        {node.children.map((child) => (
          <NodeView key={child.pointer} node={child} context={context} />
        ))}
      </div>
      <AddControls node={node} context={context} />
    </fieldset>
  )
}

function AddControls({ node, context }: { readonly node: GroupNode; readonly context: Context }) {
  const [picked, setPicked] = useState(0)
  const [key, setKey] = useState('')
  const { add, addKey } = node
  return (
    <>
      {add.length > 0 && add.length <= 4 && (
        <div className="ed-adds">
          {add.map((option) => (
            <button
              key={option.label}
              type="button"
              className="ed-add"
              onClick={() => context.commit(option.path, option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {add.length > 4 && (
        <div className="ed-adds">
          <select
            aria-label={`Add to ${node.label}`}
            value={picked}
            onChange={(event) => setPicked(Number(event.target.value))}
          >
            {add.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ed-add"
            onClick={() => {
              const option = add[picked] ?? add[0]
              if (option !== undefined) context.commit(option.path, option.value)
              setPicked(0)
            }}
          >
            Add
          </button>
        </div>
      )}
      {addKey !== null && (
        <div className="ed-adds">
          <input
            type="text"
            className="ed-key"
            aria-label={`New entry in ${node.label}`}
            placeholder="new entry"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <button
            type="button"
            className="ed-add"
            disabled={key.trim() === ''}
            onClick={() => {
              context.commit([...node.path, key.trim()], addKey.value)
              setKey('')
            }}
          >
            Add
          </button>
        </div>
      )}
    </>
  )
}

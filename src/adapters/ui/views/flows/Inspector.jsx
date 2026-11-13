import { useState } from 'react'
import { tip } from '../../tooltip.jsx'

// Right-hand editor for the selected item. Every change goes through `act`, which
// applies it to the plan (undoable, auto-saved). Field ids are stable per item.

const STATUSES = ['', 'proposed', 'approved', 'in_progress', 'done', 'failed']
const PS_KINDS = [
  ['act', 'Action'],
  ['call', 'Internal call'],
  ['ext', 'External call'],
  ['cond', 'Condition'],
  ['loop', 'Loop'],
  ['try', 'Try / except'],
  ['raise', 'Raise'],
  ['ret', 'Return'],
  ['jump', 'Continue / break'],
]
const TYPE_LABEL = {
  flow: 'Flow',
  spine: 'Step',
  wrap: 'Wrapper',
  panel: 'Detail panel',
  except: 'Except handler',
  ps: 'Pseudo-code line',
  ref: 'Reference table',
  note: 'Note',
}

function Field({ label, children }) {
  return (
    <label className="ins-field">
      <span className="ins-label">{label}</span>
      {children}
    </label>
  )
}

function Text({ id, value, onChange, mono, placeholder }) {
  return (
    <input id={id} className={`ins-input ${mono ? 'mono' : ''}`} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  )
}

function Area({ id, value, onChange, rows = 3 }) {
  return <textarea id={id} className="ins-input mono" rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
}

function Select({ id, value, options, onChange }) {
  return (
    <select id={id} className="ins-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

function Check({ id, label, checked, onChange }) {
  return (
    <label className="ins-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function Btn({ children, onClick, tone, disabled, keys }) {
  return (
    <button className={`ins-btn ${tone ? `tone-${tone}` : ''}`} onClick={onClick} disabled={disabled} {...(keys ? tip(children, { keys }) : {})}>
      {children}
    </button>
  )
}

function Rows({ idBase, rows, cols, onChange }) {
  const set = (i, j, v) => onChange(rows.map((r, k) => (k === i ? r.map((c, m) => (m === j ? v : c)) : r)))
  return (
    <div className="ins-rows">
      {rows.map((r, i) => (
        <div className="ins-row" key={i}>
          {cols.map((c, j) => (
            <input key={j} id={`${idBase}-${i}-${j}`} className="ins-input mono" placeholder={c} value={r[j] ?? ''} onChange={(e) => set(i, j, e.target.value)} />
          ))}
          <button className="ins-x" onClick={() => onChange(rows.filter((_, k) => k !== i))} aria-label="Remove row">
            ×
          </button>
        </div>
      ))}
      <button className="ins-add" onClick={() => onChange([...rows, cols.map(() => '')])}>
        + Add row
      </button>
    </div>
  )
}

function LinkSelect({ id, value, folders, onChange }) {
  return (
    <Select
      id={id}
      value={value?.tab || ''}
      options={[['', 'None'], ...folders.map((f) => [f, f])]}
      onChange={(v) => onChange(v ? { ...(value || {}), tab: v } : undefined)}
    />
  )
}

function StatusSelect({ id, value, onChange }) {
  return <Select id={id} value={value || ''} options={STATUSES.map((s) => [s, s ? s.replace('_', ' ') : 'No status'])} onChange={(v) => onChange(v || undefined)} />
}

// What the item does to the code (independent of its review status).
const CHANGES = [['', 'Context (unchanged)'], ['new', '+ New code'], ['edit', '✎ Edit existing code'], ['remove', '− Remove code']]
function ChangeSelect({ id, value, onChange }) {
  return <Select id={id} value={value || ''} options={CHANGES} onChange={(v) => onChange(v || undefined)} />
}

function ConfirmDelete({ label, onConfirm }) {
  const [armed, setArmed] = useState(false)
  return (
    <Btn tone="danger" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Click again to delete' : label}
    </Btn>
  )
}

export function Inspector({ refId, entry, folders, act, onClose, children }) {
  if (!entry) return null
  const o = entry.obj
  const id = (f) => `ins-${refId}-${f}`
  const p = (field) => (v) => act.patch({ [field]: v }, `${refId}:${field}`)

  return (
    <aside className="inspector">
      <div className="ins-head">
        <div>
          <div className="ins-type">{TYPE_LABEL[entry.type]}</div>
          <div className="ins-id">{refId}</div>
        </div>
        <button className="ins-close" onClick={onClose} aria-label="Close inspector">
          ×
        </button>
      </div>

      <div className="ins-body">
        {entry.type === 'flow' && (
          <>
            <Field label="Title"><Text id={id('title')} value={o.title} onChange={p('title')} /></Field>
            <Field label="Entry point"><Text id={id('entry')} mono value={o.entry} onChange={p('entry')} placeholder="path/to/file.py:42" /></Field>
            <Field label="Change"><ChangeSelect id={id('change')} value={o.change} onChange={p('change')} /></Field>
            <div className="ins-actions">
              <Btn onClick={() => act.flowAdd('step')} keys="S">+ Step at end</Btn>
              <Btn onClick={() => act.flowAdd('note')} keys="N">+ Note</Btn>
              <Btn onClick={() => act.flowAdd('ref')}>+ Reference table</Btn>
            </div>
            <div className="ins-actions"><ConfirmDelete label="Delete flow" onConfirm={act.remove} /></div>
          </>
        )}

        {entry.type === 'spine' && (
          <>
            <Field label="Kind">
              <Select id={id('kind')} value={o.kind} options={[['step', 'Step'], ['gather', 'Parallel tasks']]} onChange={act.setStepKind} />
            </Field>
            <Field label="Module"><Text id={id('module')} mono value={o.module} onChange={p('module')} /></Field>
            <div className="ins-pair">
              <Field label="#"><Text id={id('num')} value={o.num} onChange={(v) => act.patch({ num: v === '' ? undefined : isNaN(+v) ? v : +v }, `${refId}:num`)} /></Field>
              <Field label="Name"><Text id={id('name')} mono value={o.name} onChange={p('name')} /></Field>
            </div>
            <Field label="Description"><Text id={id('desc')} value={o.desc} onChange={p('desc')} /></Field>
            <div className="ins-checks">
              {['await', 'loop', 'background'].map((b) => (
                <Check
                  key={b}
                  id={id(`badge-${b}`)}
                  label={{ await: 'await', loop: 'loop', background: 'fire & forget' }[b]}
                  checked={o.badges?.includes(b)}
                  onChange={(on) => act.patch({ badges: on ? [...(o.badges || []), b] : (o.badges || []).filter((x) => x !== b) })}
                />
              ))}
            </div>
            <div className="ins-pair">
              <Field label="Status"><StatusSelect id={id('status')} value={o.status} onChange={p('status')} /></Field>
              <Field label="Change"><ChangeSelect id={id('change')} value={o.change} onChange={p('change')} /></Field>
            </div>
            <Field label="Links to folder"><LinkSelect id={id('link')} value={o.link} folders={folders} onChange={p('link')} /></Field>
            {o.kind === 'gather' && (
              <>
                <div className="ins-pair">
                  <Field label="Join mode">
                    <Select id={id('mode')} value={o.mode} options={[['gather', 'gather · wait for all'], ['race', 'race · first wins'], ['any', 'any · first success']]} onChange={p('mode')} />
                  </Field>
                  <Field label="Mode note"><Text id={id('modeNote')} mono value={o.modeNote} onChange={p('modeNote')} /></Field>
                </div>
                <Field label="Fan-out"><Text id={id('fanout')} mono value={o.fanout} onChange={p('fanout')} placeholder="× N tasks · one per …" /></Field>
                <Field label="Tasks (kind · call · note)">
                  <Rows
                    idBase={id('tasks')}
                    cols={['call | timer | ext', 'call', 'note']}
                    rows={(o.tasks || []).map((t) => [t.k, t.t, t.note || ''])}
                    onChange={(rows) => act.patch({ tasks: rows.map((r, i) => ({ ...(o.tasks?.[i] || {}), k: r[0] || 'call', t: r[1], note: r[2] || undefined })) }, `${refId}:tasks`)}
                  />
                </Field>
              </>
            )}
            <Field label="Inputs (name · type · description)">
              <Rows idBase={id('inputs')} cols={['name', 'type', 'description']} rows={o.inputs || []} onChange={(v) => act.patch({ inputs: v }, `${refId}:inputs`)} />
            </Field>
            <Field label="Returns"><Text id={id('returns')} mono value={o.returns} onChange={p('returns')} /></Field>
            <div className="ins-actions">
              <Btn onClick={() => act.insertStep('after')} keys="S">+ Step after</Btn>
              <Btn onClick={() => act.insertStep('before')}>+ Step before</Btn>
              <Btn onClick={act.addNote} keys="N">+ Note</Btn>
              {!o.details?.some((d) => d.side === 'left') && <Btn onClick={() => act.addPanel('left')}>+ Left panel</Btn>}
              {!o.details?.some((d) => d.side === 'right') && <Btn onClick={() => act.addPanel('right')}>+ Right panel</Btn>}
              <Btn onClick={() => act.wrap('try')}>Wrap in try</Btn>
              <Btn onClick={() => act.wrap('loop')}>Wrap in loop</Btn>
              <Btn onClick={() => act.move(-1)} keys="⌥↑">Move up</Btn>
              <Btn onClick={() => act.move(1)} keys="⌥↓">Move down</Btn>
            </div>
            <div className="ins-actions"><ConfirmDelete label="Delete step" onConfirm={act.remove} /></div>
          </>
        )}

        {entry.type === 'wrap' && (
          <>
            <Field label="Kind"><div className="ins-static">{o.kind === 'try' ? 'try / except around steps' : 'loop around steps'}</div></Field>
            <Field label="Header"><Text id={id('header')} mono value={o.header} onChange={p('header')} /></Field>
            {o.kind === 'loop' && <Field label="Accumulates"><Text id={id('acc')} mono value={o.acc} onChange={p('acc')} placeholder="results[]" /></Field>}
            <div className="ins-actions">
              <Btn onClick={() => act.move(-1)} keys="⌥↑">Move up</Btn>
              <Btn onClick={() => act.move(1)} keys="⌥↓">Move down</Btn>
              <Btn onClick={act.unwrap}>Unwrap (keep steps)</Btn>
            </div>
            <div className="ins-actions"><ConfirmDelete label="Delete with steps" onConfirm={act.remove} /></div>
          </>
        )}

        {(entry.type === 'panel' || entry.type === 'except') && (
          <>
            <Field label="Title"><Text id={id('title')} mono value={o.title} onChange={p('title')} /></Field>
            {entry.type === 'except' && <Field label="Catches"><Text id={id('label')} mono value={o.label} onChange={p('label')} placeholder="Exception as e" /></Field>}
            {entry.type === 'panel' && <Check id={id('bg')} label="Fire & forget (dashed)" checked={o.background} onChange={p('background')} />}
            <div className="ins-actions">
              <Btn onClick={() => act.addChild('items')}>+ Line</Btn>
              <Btn onClick={act.toggleCollapse}>{o.collapsed ? 'Expand' : 'Collapse'}</Btn>
            </div>
            {entry.type === 'panel' && <div className="ins-actions"><ConfirmDelete label="Delete panel" onConfirm={act.remove} /></div>}
          </>
        )}

        {entry.type === 'ps' && (
          <>
            <Field label="Kind"><Select id={id('k')} value={o.k} options={PS_KINDS} onChange={act.setPsKind} /></Field>
            {o.k === 'try' ? (
              <Field label="Catches"><Text id={id('except')} mono value={o.except} onChange={p('except')} /></Field>
            ) : (
              <Field label="Text"><Area id={id('t')} value={o.t} onChange={p('t')} /></Field>
            )}
            {o.k === 'loop' && <Field label="Accumulates"><Text id={id('acc')} mono value={o.acc} onChange={p('acc')} placeholder="results[]" /></Field>}
            {o.k === 'cond' && (
              <div className="ins-pair">
                <Field label="Left label"><Text id={id('yesLabel')} value={o.yesLabel} placeholder="Yes" onChange={p('yesLabel')} /></Field>
                <Field label="Right label"><Text id={id('noLabel')} value={o.noLabel} placeholder="No" onChange={p('noLabel')} /></Field>
              </div>
            )}
            <div className="ins-checks"><Check id={id('aw')} label="await" checked={o.aw} onChange={p('aw')} /></div>
            <div className="ins-pair">
              <Field label="Status"><StatusSelect id={id('status')} value={o.status} onChange={p('status')} /></Field>
              <Field label="Change"><ChangeSelect id={id('change')} value={o.change} onChange={p('change')} /></Field>
            </div>
            <Field label="Links to folder"><LinkSelect id={id('link')} value={o.link} folders={folders} onChange={p('link')} /></Field>
            <div className="ins-actions">
              <Btn onClick={() => act.insertPs('after')}>+ Line after</Btn>
              <Btn onClick={() => act.insertPs('before')}>+ Line before</Btn>
              {o.k === 'cond' && <Btn onClick={() => act.addChild('yes')}>+ {o.yesLabel || 'Yes'} line</Btn>}
              {o.k === 'cond' && <Btn onClick={() => act.addChild('no')}>+ {o.noLabel || 'No'} line</Btn>}
              {o.k === 'loop' && <Btn onClick={() => act.addChild('body')}>+ Body line</Btn>}
              {o.k === 'try' && <Btn onClick={() => act.addChild('body')}>+ try line</Btn>}
              {o.k === 'try' && <Btn onClick={() => act.addChild('handler')}>+ except line</Btn>}
              <Btn onClick={() => act.move(-1)} keys="⌥↑">Move up</Btn>
              <Btn onClick={() => act.move(1)} keys="⌥↓">Move down</Btn>
            </div>
            <div className="ins-actions"><Btn tone="danger" onClick={act.remove}>Delete line</Btn></div>
          </>
        )}

        {entry.type === 'ref' && (
          <>
            <Field label="Title"><Text id={id('title')} mono value={o.title} onChange={p('title')} /></Field>
            <Field label="Subtitle"><Text id={id('subtitle')} mono value={o.subtitle} onChange={p('subtitle')} /></Field>
            <Field label="Rows (name · type · description)">
              <Rows idBase={id('rows')} cols={['name', 'type', 'description']} rows={o.rows || []} onChange={(v) => act.patch({ rows: v }, `${refId}:rows`)} />
            </Field>
            <div className="ins-actions">
              <Btn onClick={() => act.move(-1)} keys="⌥↑">Move up</Btn>
              <Btn onClick={() => act.move(1)} keys="⌥↓">Move down</Btn>
              <Btn tone="danger" onClick={act.remove}>Delete table</Btn>
            </div>
          </>
        )}

        {entry.type === 'note' && (
          <>
            <Field label="Label">
              <Select id={id('tone')} value={o.tone || 'note'} options={[['note', 'Note'], ['check', 'Check'], ['fix', 'Fix'], ['idea', 'Idea'], ['question', 'Question']]} onChange={p('tone')} />
            </Field>
            <Field label="Text"><Area id={id('text')} rows={6} value={o.text} onChange={p('text')} /></Field>
            <div className="ins-actions"><Btn tone="danger" onClick={act.remove}>Delete note</Btn></div>
          </>
        )}
        {children}
      </div>
    </aside>
  )
}

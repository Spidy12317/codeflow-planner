import { useContext } from 'react'
import { Handle, Position, BaseEdge } from '@xyflow/react'
import { LinkContext, EditContext, LinkInfoContext } from '../../../links.js'
import { tip } from '../../../tooltip.jsx'
import { ThreadBadge } from '../../../Threads.jsx'

const BADGE = {
  await: { cls: 'pill-await', text: 'await' },
  loop: { cls: 'pill-loop', text: '↻ loop' },
  background: { cls: 'pill-bg', text: 'fire & forget' },
}

const JOIN = {
  race: 'first completed wins',
  gather: 'wait for all',
  any: 'first success wins',
}

// What the item does to the code. Removal is slate + struck through, never red: red is
// already raise / try / except.
export const CHANGE_TEXT = { new: '+ NEW', edit: '✎ EDIT', remove: '− REMOVE' }
const ChangePill = ({ change }) => (CHANGE_TEXT[change] ? <span className={`pill chg chg-${change}`}>{CHANGE_TEXT[change]}</span> : null)
const cardClass = (s, extra = '') => `card ${extra} ${s.status ? `has-status st-${s.status}` : ''} ${s.change ? `ch-${s.change}` : s.inheritedChange ? 'ch-quiet' : ''}`

// Card and panel share a row's top edge, so a common handle offset keeps drill arrows horizontal.
const DRILL_Y = { top: 26 }

// ── spine cards ─────────────────────────────────────────────────────────────

function CardHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" style={DRILL_Y} />
      <Handle type="source" position={Position.Right} id="right" style={DRILL_Y} />
    </>
  )
}

function Chevron({ refId, collapsed }) {
  const { toggleCollapse } = useContext(EditContext)
  return (
    <button
      className={`chev nodrag ${collapsed ? 'is-collapsed' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        toggleCollapse(refId)
      }}
      title={collapsed ? 'Expand' : 'Collapse'}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
    >
      ▾
    </button>
  )
}

function CardHead({ s, extra }) {
  const onLink = useContext(LinkContext)
  const linkInfo = useContext(LinkInfoContext)
  const target = s.link && linkInfo(s.link)
  return (
    <div className="card-head">
      <Chevron refId={s.id} collapsed={s.collapsed} />
      <div className="card-module">{s.module}</div>
      <div className="card-title">
        {s.num != null && <span className="card-num">{s.num}</span>}
        <span className="card-name">{s.name}</span>
      </div>
      {s.desc && <div className="card-desc">{s.desc}</div>}
      <div className="card-tags">
        {(s.badges || []).map((b) => (
          <span key={b} className={`pill ${BADGE[b]?.cls || ''}`}>
            {BADGE[b]?.text || b}
          </span>
        ))}
        {extra}
        <ChangePill change={s.change} />
        {s.status && <span className={`pill pill-status st-${s.status}`}>{s.status.replace('_', ' ')}</span>}
        {s.link && (
          <button className="link-chip nodrag" onClick={(e) => (e.stopPropagation(), onLink(s.link))} {...tip(target.title, { desc: 'Click to open it' })}>
            ↗ {target.path}
          </button>
        )}
      </div>
    </div>
  )
}

function Rows({ rows }) {
  if (!rows?.length) return null
  return (
    <div className="card-rows">
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <span className="c-name">{r[0]}</span>
          <span className="c-type">{r[1]}</span>
          <span className="c-desc">{r[2]}</span>
        </div>
      ))}
    </div>
  )
}

function Returns({ value }) {
  if (!value) return null
  return (
    <div className="card-returns">
      <span className="ret-label">returns</span>
      <code>{value}</code>
    </div>
  )
}

export function StepNode({ data }) {
  const s = data.item
  return (
    <div className={cardClass(s)}>
      <CardHandles />
      <CardHead s={s} />
      {!s.collapsed && (
        <>
          <Rows rows={s.inputs} />
          <Returns value={s.returns} />
        </>
      )}
    </div>
  )
}

export function GatherNode({ data }) {
  const s = data.item
  const onLink = useContext(LinkContext)
  const modeTag = (
    <span className="pill pill-mode">
      ⑂ {s.mode}
      {s.modeNote && <span className="pill-sub">&nbsp;· {s.modeNote}</span>}
    </span>
  )
  return (
    <div className={cardClass(s, 'card-gather')}>
      <CardHandles />
      <CardHead s={s} extra={modeTag} />
      {!s.collapsed && (
      <>
      <div className="gather-body">
        {s.fanout && <div className="fanout">{s.fanout}</div>}
        <div className="tasks">
          {(s.tasks || []).map((t, i) => (
            <div
              key={i}
              className={`task task-${t.k} ${t.link ? 'is-link nodrag' : ''}`}
              onClick={t.link ? (e) => (e.stopPropagation(), onLink(t.link)) : undefined}
            >
              <span className="task-kind">{{ call: 'task', timer: 'timer', ext: 'external' }[t.k] || t.k}</span>
              <span className="task-text">
                {t.t}
                {t.link && <span className="linkmark"> ↗</span>}
                {t.note && <span className="task-note">{t.note}</span>}
              </span>
            </div>
          ))}
        </div>
        <div className="join">
          <span className="join-dot">⊕</span> join · {JOIN[s.mode] || s.mode}
        </div>
      </div>
      <Returns value={s.returns} />
      </>
      )}
    </div>
  )
}

// ── detail panels + pseudo-code nodes ───────────────────────────────────────

export function PanelNode({ data }) {
  const d = data.detail
  return (
    <div className={`panel ${d.variant === 'except' ? 'panel-except' : ''} ${d.background ? 'panel-bg' : ''}`}>
      <Handle type="target" position={Position.Left} id="l" style={DRILL_Y} />
      <Handle type="target" position={Position.Right} id="r" style={DRILL_Y} />
      <div className="panel-head">
        <span className="panel-title">{d.title}</span>
        {d.background && <span className="pill pill-bg">fire & forget</span>}
        <Chevron refId={data.ref} collapsed={d.collapsed} />
      </div>
    </div>
  )
}

function PsHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="ls" />
      <Handle type="source" position={Position.Right} id="rs" />
      <Handle type="target" position={Position.Right} id="rt" />
    </>
  )
}

const BADGE_TEXT = { await: 'await', external: 'external' }

export function PsNode({ data }) {
  const { it, variant, lines, badges, status, change, quiet } = data
  const onLink = useContext(LinkContext)
  const linkInfo = useContext(LinkInfoContext)
  const target = it.link && linkInfo(it.link)
  return (
    <div
      className={`ps ps-${variant} ${it.link ? 'is-link' : ''} ${status ? `has-status st-${status}` : ''} ${change ? `ch-${change}` : quiet ? 'ch-quiet' : ''}`}
      onDoubleClick={it.link ? () => onLink(it.link) : undefined}
      title={it.link ? `Double-click to open ${target.path}` : undefined}
    >
      {variant === 'cond' && (
        <svg className="ps-hex" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {/* ring first: a wide stroke whose inner half the shape covers, so status / change
              rings follow the hexagon instead of the node's box */}
          <polygon className="ps-hex-ring" points="7,1 93,1 99,50 93,99 7,99 1,50" vectorEffect="non-scaling-stroke" />
          <polygon points="7,1 93,1 99,50 93,99 7,99 1,50" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {badges.length > 0 && (
        <div className="ps-badges">
          {badges.map((b) =>
            b === 'link' ? (
              <button key={b} className="ps-link nodrag" onClick={(e) => (e.stopPropagation(), onLink(it.link))} {...tip(target.title, { desc: 'Click to open it' })}>
                ↗ {target.label}
              </button>
            ) : (
              <span key={b} className={`ps-badge ps-badge-${b}`}>
                {BADGE_TEXT[b]}
              </span>
            ),
          )}
        </div>
      )}
      <div className="ps-text">{lines.join('\n')}</div>
      <PsHandles />
    </div>
  )
}

export function PsGroupNode() {
  return (
    <div className="psgroup">
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
    </div>
  )
}

export function JunctionNode() {
  return (
    <div className="junction">
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="rs" />
    </div>
  )
}

// ── spine wrappers ──────────────────────────────────────────────────────────

export function TryFrameNode({ data }) {
  const it = data.item
  return (
    <div className="wrapframe tryframe">
      <div className="wrap-head">
        <span className="wrap-tag tag-try">try</span>
        <span>{it.header}</span>
      </div>
      <Handle type="source" position={Position.Right} id="r" style={{ top: 'auto', bottom: 40 }} />
    </div>
  )
}

export function LoopFrameNode({ data }) {
  const it = data.item
  return (
    <div className="wrapframe loopframe">
      <div className="wrap-head">
        <span className="wrap-tag tag-loop">↻ loop</span>
        <span>{it.header}</span>
        {it.acc && <span className="acc">→ {it.acc}</span>}
      </div>
    </div>
  )
}

// ── reference tables, notes, frames ─────────────────────────────────────────

export function RefNode({ data }) {
  const r = data.item
  return (
    <div className="ref">
      <div className="ref-head">
        <span className="ref-title">{r.title}</span>
        {r.subtitle && <span className="ref-sub">{r.subtitle}</span>}
      </div>
      <Rows rows={r.rows} />
    </div>
  )
}

export function StickyNode({ data }) {
  const n = data.item
  return (
    <div className={`sticky tone-${n.tone || 'note'}`}>
      {n.tone && <div className="sticky-tone">{n.tone}</div>}
      {n.text}
    </div>
  )
}

export function FrameNode({ data }) {
  return (
    <div className={`frame ${data.change ? `ch-${data.change}` : ''}`}>
      {data.change && (
        <div className="frame-change">
          <ChangePill change={data.change} />
        </div>
      )}
      <div className="frame-title">{data.title}</div>
      {data.entry && <div className="frame-entry">{data.entry}</div>}
    </div>
  )
}

// Thread badge sits beside the node body (not inside it) so rounded/clipped cards don't cut it off.
const withBadge = (Node) => {
  const Badged = (props) => (
    <>
      <Node {...props} />
      <ThreadBadge refId={props.data.ref} />
    </>
  )
  return Badged
}

export const nodeTypes = {
  step: withBadge(StepNode),
  gather: withBadge(GatherNode),
  panel: withBadge(PanelNode),
  ps: withBadge(PsNode),
  psgroup: PsGroupNode,
  junction: JunctionNode,
  ref: withBadge(RefNode),
  sticky: withBadge(StickyNode),
  frame: withBadge(FrameNode),
  loopframe: withBadge(LoopFrameNode),
  tryframe: withBadge(TryFrameNode),
}

// ── edges ───────────────────────────────────────────────────────────────────

function roundedPath(pts, r) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const d1 = Math.hypot(x1 - x0, y1 - y0) || 1
    const d2 = Math.hypot(x2 - x1, y2 - y1) || 1
    const rr = Math.min(r, d1 / 2, d2 / 2)
    const ax = x1 - ((x1 - x0) / d1) * rr
    const ay = y1 - ((y1 - y0) / d1) * rr
    const bx = x1 + ((x2 - x1) / d2) * rr
    const by = y1 + ((y2 - y1) / d2) * rr
    d += ` L ${ax} ${ay} Q ${x1} ${y1} ${bx} ${by}`
  }
  const last = pts[pts.length - 1]
  return `${d} L ${last[0]} ${last[1]}`
}

// Orthogonal edge through a vertical lane: loop back-edges (up the right side) and
// empty-branch bypasses (down the outer side, then into the next node's top).
export function LaneEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, style, ...rest }) {
  const L = sourceX + data.laneDx
  const back = data.mode === 'back'
  const pts = back
    ? [[sourceX, sourceY], [L, sourceY], [L, targetY], [targetX, targetY]]
    : [[sourceX, sourceY], [L, sourceY], [L, targetY - 15], [targetX, targetY - 15], [targetX, targetY]]
  const labelX = back ? L : (sourceX + L) / 2
  const labelY = back ? (sourceY + targetY) / 2 : sourceY
  return (
    <BaseEdge
      id={id}
      path={roundedPath(pts, 12)}
      markerEnd={markerEnd}
      style={style}
      labelX={labelX}
      labelY={labelY}
      label={rest.label}
      labelStyle={rest.labelStyle}
      labelShowBg={rest.labelShowBg}
      labelBgStyle={rest.labelBgStyle}
      labelBgPadding={rest.labelBgPadding}
      labelBgBorderRadius={rest.labelBgBorderRadius}
    />
  )
}

// Pseudo-code connector: from a side handle go across then down; from the bottom go down,
// turn once just above the target, then drop in. Merging branches share that last segment.
export function OrthoEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, markerEnd, style, ...rest }) {
  const side = sourcePosition === 'left' || sourcePosition === 'right'
  const turnY = targetY - 15
  const pts =
    Math.abs(sourceX - targetX) < 1
      ? [[sourceX, sourceY], [targetX, targetY]]
      : side
        ? [[sourceX, sourceY], [targetX, sourceY], [targetX, targetY]]
        : [[sourceX, sourceY], [sourceX, turnY], [targetX, turnY], [targetX, targetY]]
  const labelX = side ? (sourceX + targetX) / 2 : sourceX
  const labelY = side ? sourceY : sourceY + 12
  return (
    <BaseEdge
      id={id}
      path={roundedPath(pts, 10)}
      markerEnd={markerEnd}
      style={style}
      labelX={labelX}
      labelY={labelY}
      label={rest.label}
      labelStyle={rest.labelStyle}
      labelShowBg={rest.labelShowBg}
      labelBgStyle={rest.labelBgStyle}
      labelBgPadding={rest.labelBgPadding}
      labelBgBorderRadius={rest.labelBgBorderRadius}
    />
  )
}

export const edgeTypes = { lane: LaneEdge, ortho: OrthoEdge }

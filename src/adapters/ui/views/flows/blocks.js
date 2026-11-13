import { wrap, PS_LINE } from './measure.js'

// Structured layout for pseudo-code inside detail panels. Every block measures itself
// first ({ w, h }) and then emits nodes/edges at absolute coordinates via `emit`,
// returning { entry, exits } so the parent can wire sequence edges.
//
//   sequence  → stacked, centred, edge from each block's open exits to the next entry
//   cond      → node on top, Yes branch left / No branch right, branches rejoin below
//   try       → "try" pill, body left / except handler right (dashed "raises" edge)
//   loop      → dashed frame, head pill, body, junction, back-edge up the right lane
//   raise / ret / jump → terminal, no outgoing edge
//
// Node ids derive from item ids (stable across edits); `data.ref` points at the plan item.

export const B = {
  LEAF_W: 250,
  JUMP_W: 150,
  TRY_W: 110,
  GAP_V: 30,
  BR_GAP: 30,
  EMPTY_W: 40,
  FRAME_PAD: 14,
  LANE: 26,
  JUNC: 10,
  PAD_X: 12,
  PAD_Y: 8,
  BADGE_H: 20,
  PANEL_PAD: 20,
  PANEL_HEAD: 42,
  PANEL_MIN_W: 300,
}

const TERMINAL = new Set(['raise', 'ret', 'jump'])
const PILL = new Set(['raise', 'ret', 'jump', 'loophead', 'tryhead', 'excepthead'])
const VARIANTS = new Set(['act', 'call', 'ext', 'raise', 'ret', 'jump', 'cond', 'loophead', 'tryhead', 'excepthead'])

function leafSize(it) {
  const variant = VARIANTS.has(it.k) ? it.k : 'act'
  const w = variant === 'jump' ? B.JUMP_W : variant === 'tryhead' ? B.TRY_W : B.LEAF_W
  const inset = variant === 'cond' ? 26 : PILL.has(variant) ? 18 : B.PAD_X
  const text = it.acc ? `${it.t}  → ${it.acc}` : it.t
  const lines = wrap(text, w - inset * 2)
  const badges = []
  if (it.aw) badges.push('await')
  if (it.k === 'ext') badges.push('external')
  if (it.link) badges.push('link')
  const h = B.PAD_Y * 2 + lines.length * PS_LINE + (badges.length ? B.BADGE_H : 0)
  return { variant, w, h, lines, badges }
}

// `view` is what gets drawn; `owner` is the plan item it edits (differs for synthetic heads).
function leafBlock(view, owner = view, id = view.id) {
  const s = leafSize(view)
  return {
    w: s.w,
    h: s.h,
    emit(x, y, env) {
      env.add({
        id,
        type: 'ps',
        x,
        y,
        w: s.w,
        h: s.h,
        data: { ref: owner.id, it: view, status: owner.status, change: owner.change, quiet: !!owner.inheritedChange, variant: s.variant, lines: s.lines, badges: s.badges },
      })
      return { entry: id, exits: TERMINAL.has(view.k) ? [] : [{ id }] }
    },
  }
}

export function seqBlock(items) {
  const blocks = items.map(itemBlock)
  const w = Math.max(0, ...blocks.map((b) => b.w))
  const h = blocks.reduce((s, b) => s + b.h, 0) + B.GAP_V * Math.max(0, blocks.length - 1)
  return {
    w,
    h,
    emit(x, y, env) {
      let cy = y
      let entry = null
      let exits = []
      blocks.forEach((b, i) => {
        const r = b.emit(x + (w - b.w) / 2, cy, env)
        if (i === 0) entry = r.entry
        else env.connect(exits, r.entry)
        exits = r.exits
        cy += b.h + B.GAP_V
      })
      return { entry, exits }
    },
  }
}

// Head node with two optional columns underneath. An empty column becomes a bypass
// exit that leaves the head sideways and runs down a lane at the block's outer edge.
function branchBlock(head, leftItems, rightItems, opts) {
  const L = leftItems?.length ? seqBlock(leftItems) : null
  const R = rightItems?.length ? seqBlock(rightItems) : null
  const lw = L ? L.w : B.EMPTY_W
  const rw = R ? R.w : B.EMPTY_W
  const bw = lw + B.BR_GAP + rw
  const w = Math.max(head.w + B.EMPTY_W * 2, bw)
  const top = head.h + B.GAP_V + 6
  const h = top + Math.max(L?.h || 0, R?.h || 0)
  return {
    w,
    h,
    emit(x, y, env) {
      const hx = x + (w - head.w) / 2
      const hr = head.emit(hx, y, env)
      const bx = x + (w - bw) / 2
      const by = y + top
      const exits = []
      // Leave from the side only when the column sits outside the head; otherwise from the bottom.
      const leftSide = bx + lw / 2 < hx - 8 ? 'ls' : 'b'
      const rightSide = bx + lw + B.BR_GAP + rw / 2 > hx + head.w + 8 ? 'rs' : 'b'
      if (L) {
        const r = L.emit(bx + (lw - L.w) / 2, by, env)
        env.edge(hr.entry, r.entry, { type: 'ortho', sh: leftSide, label: opts.leftLabel, cls: opts.leftCls })
        exits.push(...r.exits)
      } else {
        // Lane offsets are relative to the source handle so they survive dragging.
        exits.push({ id: hr.entry, handle: 'ls', label: opts.leftLabel, laneDx: x + 6 - hx })
      }
      if (R) {
        const r = R.emit(bx + lw + B.BR_GAP + (rw - R.w) / 2, by, env)
        env.edge(hr.entry, r.entry, { type: 'ortho', sh: rightSide, label: opts.rightLabel, cls: opts.rightCls })
        exits.push(...r.exits)
      } else {
        exits.push({ id: hr.entry, handle: 'rs', label: opts.rightLabel, laneDx: x + w - 6 - (hx + head.w) })
      }
      return { entry: hr.entry, exits }
    },
  }
}

function loopBlock(it) {
  const head = leafBlock({ k: 'loophead', t: `↻ ${it.t}`, acc: it.acc }, it, it.id)
  const body = seqBlock(it.body || [])
  const inner = Math.max(head.w, body.w)
  const w = inner + B.FRAME_PAD * 2 + B.LANE
  const h = B.FRAME_PAD + head.h + B.GAP_V + body.h + B.GAP_V + B.JUNC + B.FRAME_PAD
  return {
    w,
    h,
    emit(x, y, env) {
      const gid = env.add({ id: `${it.id}:grp`, type: 'psgroup', x, y, w, h, data: { ref: it.id } })
      env.push(gid)
      const ix = x + B.FRAME_PAD
      const hr = head.emit(ix + (inner - head.w) / 2, y + B.FRAME_PAD, env)
      const by = y + B.FRAME_PAD + head.h + B.GAP_V
      const br = body.emit(ix + (inner - body.w) / 2, by, env)
      env.edge(hr.entry, br.entry, { type: 'ortho' })
      const jx = ix + inner / 2 - B.JUNC / 2
      const jid = env.add({ id: `${it.id}:j`, type: 'junction', x: jx, y: by + body.h + B.GAP_V, w: B.JUNC, h: B.JUNC, data: { ref: it.id } })
      env.connect(br.exits, jid)
      env.edge(jid, hr.entry, {
        type: 'lane',
        sh: 'rs',
        th: 'rt',
        cls: 'edge-back',
        label: 'next',
        data: { mode: 'back', laneDx: x + w - B.LANE / 2 - (jx + B.JUNC) },
      })
      env.pop()
      return { entry: hr.entry, exits: [{ id: gid, handle: 'b' }] }
    },
  }
}

function itemBlock(it) {
  if (it.k === 'cond') {
    return branchBlock(leafBlock(it), it.yes, it.no, {
      leftLabel: it.yesLabel || 'Yes',
      rightLabel: it.noLabel || 'No',
    })
  }
  if (it.k === 'try') {
    return branchBlock(
      leafBlock({ k: 'tryhead', t: 'try' }, it, it.id),
      it.body,
      [{ id: `${it.id}:exc`, k: 'excepthead', t: `except ${it.except}`, _owner: it }, ...(it.handler || [])],
      { rightLabel: 'raises', rightCls: 'edge-raise' },
    )
  }
  if (it.k === 'excepthead') return leafBlock(it, it._owner, it.id)
  if (it.k === 'loop') return loopBlock(it)
  return leafBlock(it)
}

export function panelBlock(detail, ref) {
  const content = seqBlock(detail.items || [])
  const w = Math.max(content.w + B.PANEL_PAD * 2, B.PANEL_MIN_W)
  const open = !detail.collapsed
  const h = open ? B.PANEL_HEAD + B.PANEL_PAD + content.h + B.PANEL_PAD : B.PANEL_HEAD
  return {
    w,
    h,
    emit(x, y, env, id) {
      env.add({ id, type: 'panel', x, y, w, h, data: { ref, detail }, z: 2 })
      if (!open) return
      env.push(id)
      content.emit(x + (w - content.w) / 2, y + B.PANEL_HEAD + B.PANEL_PAD, env)
      env.pop()
    },
  }
}

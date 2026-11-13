import { MarkerType } from '@xyflow/react'
import { panelBlock } from './blocks.js'

// Vertical = sequence (spine of step cards). Horizontal = drill-down (detail panels).
// Column order inside a flow frame: [left panels] [spine] [right panels] [refs + notes]
// try / loop on the spine wrap their steps in a frame; a try's except handler is a
// panel in the right column, reached by a dashed "raises" edge from the frame.
// Manual drags are stored as offsets in tab.positions and applied on top of the layout.
export const C = {
  CARD_W: 560,
  REF_W: 480,
  GAP_X: 80,
  GAP_Y: 70,
  PAD: 64,
  TITLE_H: 140,
  WRAP_HEAD: 54,
  WRAP_PAD: 30,
  WRAP_INSET: 30,
  FLOW_GAP: 240,
}

// Theme tokens from styles.css, so arrowheads switch with light/dark.
const EDGE_COLOR = {
  'edge-spine': 'var(--e-spine)',
  'edge-flow': 'var(--e-flow)',
  'edge-drill': 'var(--e-drill)',
  'edge-back': 'var(--e-back)',
  'edge-raise': 'var(--e-raise)',
  'edge-bg': 'var(--e-drill)',
}

// Initial estimates for HTML cards; replaced by measured heights after render.
const estCard = (s) =>
  s.collapsed
    ? 92
    : 92 + (s.inputs?.length || 0) * 34 + (s.tasks ? 80 + s.tasks.length * 52 : 0) + (s.returns ? 50 : 0)
const estRef = (r) => 64 + r.rows.length * 34
const estNote = (n) => 48 + Math.ceil((n.text || '').length / 36) * 18

function makeEnv(positions) {
  const nodes = []
  const edges = []
  const abs = {}
  const byId = {}
  const stack = []
  let ek = 0

  const env = {
    add({ id, type, x, y, w, h, data, z }) {
      abs[id] = { x, y }
      const node = { id, type, parentId: stack[stack.length - 1], data: data || {}, position: { x, y } }
      if (w != null) node.style = { width: w, height: h }
      if (z != null) node.zIndex = z
      if (['junction', 'psgroup', 'loopframe', 'tryframe'].includes(type)) node.draggable = false
      nodes.push(node)
      byId[id] = node
      return id
    },
    setSize(id, w, h) {
      byId[id].style = { width: w, height: h }
    },
    push: (id) => stack.push(id),
    pop: () => stack.pop(),
    edge(source, target, o = {}) {
      const cls = o.cls || 'edge-flow'
      const e = {
        id: `e${++ek}`,
        source,
        target,
        sourceHandle: o.sh || 'b',
        targetHandle: o.th || 't',
        type: o.type || 'smoothstep',
        className: cls,
        data: o.data,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLOR[cls] },
        pathOptions: { borderRadius: 12, offset: 16 },
        zIndex: 1000,
        selectable: false,
      }
      if (o.label) {
        e.label = o.label
        e.labelStyle = { fontSize: 10, fontWeight: 600, fill: 'var(--label-ink)', fontFamily: 'Inter, sans-serif' }
        e.labelShowBg = true
        e.labelBgStyle = { fill: 'var(--label-bg)', stroke: 'var(--line)' }
        e.labelBgPadding = [5, 2]
        e.labelBgBorderRadius = 4
      }
      edges.push(e)
    },
    // Wire a block's open exits into the next entry. Bypass exits carry a lane offset.
    connect(exits, target) {
      for (const x of exits) {
        if (x.laneDx != null) {
          env.edge(x.id, target, { type: 'lane', sh: x.handle, label: x.label, data: { mode: 'bypass', laneDx: x.laneDx } })
        } else {
          env.edge(x.id, target, { type: 'ortho', sh: x.handle || 'b', label: x.label })
        }
      }
    },
    finalize() {
      for (const n of nodes) {
        if (n.parentId) {
          const p = abs[n.parentId]
          n.position = { x: abs[n.id].x - p.x, y: abs[n.id].y - p.y }
        }
        n.data._lp = n.position
        const off = positions[n.id]
        if (off) n.position = { x: n.position.x + off.dx, y: n.position.y + off.dy }
      }
      return { nodes, edges }
    },
  }
  return env
}

function walk(items, fn) {
  for (const it of items || []) {
    fn(it)
    if (it.kind === 'loop' || it.kind === 'try') walk(it.body, fn)
  }
}

// Bump when the automatic layout changes shape. Hand-moved positions are offsets from the
// automatic position, so offsets saved against another layout version would land in the wrong
// place (e.g. on top of other cards); they are ignored until the user moves things again.
export const LAYOUT_VERSION = 2

export const currentPositions = (tab) => (tab?.positions && tab.positionsLayout === LAYOUT_VERSION ? tab.positions : null)

export function layoutTab(tab, sizes = {}) {
  const env = makeEnv(currentPositions(tab) || {})
  let fx = 0

  for (const flow of tab.flows || []) {
    // Where each panel is drawn. A step whose panels are all on one side alternates
    // right / left down the spine so the flow uses both sides; a step with panels on both
    // sides keeps them as written. Panel ids keep their stored side.
    const drawSide = {}
    let alt = 0
    walk(flow.spine, (it) => {
      const sides = new Set((it.details || []).map((d) => d.side))
      if (!sides.size) return
      const side = sides.size > 1 ? null : alt++ % 2 === 0 ? 'right' : 'left'
      for (const d of it.details) drawSide[`${it.id}:${d.side}`] = side || d.side
    })

    // Measure every panel first so the side columns get the right width.
    const panels = {}
    const handlers = {}
    walk(flow.spine, (it) => {
      for (const d of it.details || []) panels[`${it.id}:${d.side}`] = panelBlock(d, `${it.id}:${d.side}`)
      if (it.kind === 'try' && it.except) {
        handlers[it.id] = panelBlock(
          { ...it.except, title: it.except.title || `except ${it.except.label}`, variant: 'except' },
          `${it.id}:except`,
        )
      }
    })
    const widthOf = (side) => Math.max(0, ...Object.entries(panels).filter(([k]) => drawSide[k] === side).map(([, b]) => b.w))
    const leftW = widthOf('left')
    const rightW = Math.max(widthOf('right'), ...Object.values(handlers).map((b) => b.w), 0)

    const spineX = C.PAD + (leftW ? leftW + C.GAP_X : 0) + C.WRAP_INSET
    const rightX = spineX + C.CARD_W + C.GAP_X + C.WRAP_INSET
    const sideX = rightX + (rightW ? rightW + C.GAP_X : 0)
    const hasSide = (flow.refs?.length || 0) + (flow.notes?.length || 0) > 0

    const fid = `frame:${flow.id}`
    env.add({ id: fid, type: 'frame', x: fx, y: 0, w: 0, h: 0, data: { ref: flow.id, title: flow.title, entry: flow.entry, change: flow.change }, z: 0 })
    env.push(fid)

    const colBottom = { left: 0, right: 0 }
    const rowY = {}
    let prev = null
    let maxY = C.TITLE_H

    const placePanel = (block, side, y, id) => {
      const x = side === 'left' ? spineX - C.WRAP_INSET - C.GAP_X - block.w : rightX
      const py = Math.max(y, colBottom[side] ? colBottom[side] + 36 : 0)
      block.emit(fx + x, py, env, id)
      colBottom[side] = py + block.h
      maxY = Math.max(maxY, py + block.h)
      return py
    }

    const place = (items, y, depth) => {
      for (const it of items) {
        if (it.kind === 'loop' || it.kind === 'try') {
          const top = y
          const gid = `${it.kind}:${it.id}`
          const inset = C.WRAP_INSET - depth * 10
          env.add({
            id: gid,
            type: it.kind === 'loop' ? 'loopframe' : 'tryframe',
            x: fx + spineX - inset,
            y: top,
            w: 0,
            h: 0,
            data: { ref: it.id, item: it },
            z: 1,
          })
          y = place(it.body || [], top + C.WRAP_HEAD, depth + 1)
          const h = Math.max(y - C.GAP_Y - top + C.WRAP_PAD, C.WRAP_HEAD + C.WRAP_PAD)
          env.setSize(gid, C.CARD_W + inset * 2, h)
          if (it.kind === 'try' && handlers[it.id]) {
            const hb = handlers[it.id]
            const hid = `${it.id}:except`
            placePanel(hb, 'right', Math.max(top, top + h - hb.h), hid)
            env.edge(gid, hid, { sh: 'r', th: 'l', cls: 'edge-raise', label: 'raises' })
          }
          maxY = Math.max(maxY, top + h)
          y = top + h + C.GAP_Y
          continue
        }

        const cardH = sizes[it.id] ?? estCard(it)
        rowY[it.id] = y
        env.add({ id: it.id, type: it.kind === 'gather' ? 'gather' : 'step', x: fx + spineX, y, data: { ref: it.id, item: it }, z: 2 })
        const rowH = cardH
        for (const d of it.details || []) {
          const id = `${it.id}:${d.side}`
          const side = drawSide[id]
          // The spine doesn't wait for panels: they alternate sides, so the next step's panel
          // goes to the other column. A panel only moves down if the one above it on its own
          // side is still in the way (placePanel).
          placePanel(panels[id], side, y, id)
          env.edge(it.id, id, {
            sh: side,
            th: side === 'left' ? 'r' : 'l',
            cls: d.background ? 'edge-bg' : 'edge-drill',
          })
        }
        if (prev) env.edge(prev, it.id, { sh: 'bottom', th: 'top', cls: 'edge-spine' })
        prev = it.id
        maxY = Math.max(maxY, y + rowH)
        y += rowH + C.GAP_Y
      }
      return y
    }

    place(flow.spine || [], C.TITLE_H, 0)

    let sy = C.TITLE_H
    for (const r of flow.refs || []) {
      env.add({ id: r.id, type: 'ref', x: fx + sideX, y: sy, data: { ref: r.id, item: r }, z: 2 })
      sy += (sizes[r.id] ?? estRef(r)) + 36
    }
    for (const n of flow.notes || []) {
      const y = Math.max(sy, rowY[n.anchor] ?? sy)
      env.add({ id: n.id, type: 'sticky', x: fx + sideX, y, data: { ref: n.id, item: n }, z: 2 })
      sy = y + (sizes[n.id] ?? estNote(n)) + 36
    }

    const right = hasSide ? sideX + C.REF_W : rightW ? rightX + rightW : spineX + C.CARD_W + C.WRAP_INSET
    const width = right + C.PAD
    env.setSize(fid, width, Math.max(maxY, sy - 36) + C.PAD)
    env.pop()
    fx += width + C.FLOW_GAP
  }

  return env.finalize()
}

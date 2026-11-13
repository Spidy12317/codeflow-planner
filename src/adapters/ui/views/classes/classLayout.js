import dagre from '@dagrejs/dagre'
import { LAYERS, breaksRule } from '../../../../domain/project/layers.js'

// UML class diagram layout: one swimlane per Clean Architecture layer, innermost (domain)
// on the left. Inside a lane dagre stacks classes top-down, parents above children.

export const NODE_W = 250
const ROW = 17
const MAX_ROWS = 10
const HEAD = 46
const PAD = 12
const LANE_GAP = 90
const LANE_PAD = 36
const GAP = 36

export const LANES = [...LAYERS, 'other']
const laneOf = (c) => c.layer || 'other'

const shown = (n) => Math.min(n, MAX_ROWS) + (n > MAX_ROWS ? 1 : 0)
export const visibleMembers = (list) => ({ items: list.slice(0, MAX_ROWS), more: Math.max(0, list.length - MAX_ROWS) })

export function nodeHeight(c) {
  const attrs = Math.max(1, shown(c.attributes.length))
  const methods = Math.max(1, shown(c.methods.length))
  return HEAD + attrs * ROW + methods * ROW + PAD * 2
}

// UML notation per relation kind. Inheritance/realization point at the parent; composition
// and aggregation put the diamond on the whole (the source).
const EDGE_STYLE = {
  inherits: { markerEnd: 'uml-triangle' },
  realizes: { markerEnd: 'uml-triangle' },
  composes: { markerStart: 'uml-diamond-filled', markerEnd: 'uml-arrow' },
  aggregates: { markerStart: 'uml-diamond', markerEnd: 'uml-arrow' },
  depends: { markerEnd: 'uml-arrow' },
}

export function relationEdges(classes, { showDepends = true } = {}) {
  const byId = new Map(classes.map((c) => [c.id, c]))
  const seen = new Set()
  const edges = []
  for (const c of classes) {
    for (const r of c.relations || []) {
      const t = r.target && byId.get(r.target)
      if (!t || t.id === c.id) continue
      if (r.kind === 'depends' && !showDepends) continue
      const key = `${c.id}|${t.id}`
      if (seen.has(key)) continue // strongest relation first in the extractor's order
      seen.add(key)
      const violation = breaksRule(c.layer, t.layer)
      edges.push({
        id: `${r.kind}:${key}`,
        source: c.id,
        target: t.id,
        type: 'default',
        className: `uml uml-${r.kind} ${violation ? 'uml-violation' : ''}`,
        data: { kind: r.kind, via: r.via, violation },
        ...EDGE_STYLE[r.kind],
      })
    }
  }
  return edges
}

// dagre layout of one connected group; positions relative to the group's top-left.
function layoutGroup(members, edges) {
  if (members.length === 1) return { width: NODE_W, height: nodeHeight(members[0]), pos: new Map([[members[0].id, { x: 0, y: 0 }]]) }
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 64, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const c of members) g.setNode(c.id, { width: NODE_W, height: nodeHeight(c) })
  for (const e of edges) {
    // parent above child: dagre edges run top → bottom
    if (e.data.kind === 'inherits' || e.data.kind === 'realizes') g.setEdge(e.target, e.source)
    else g.setEdge(e.source, e.target)
  }
  dagre.layout(g)
  const pos = new Map(members.map((c) => {
    const n = g.node(c.id)
    return [c.id, { x: n.x - NODE_W / 2, y: n.y - n.height / 2 }]
  }))
  return { width: g.graph().width, height: g.graph().height, pos }
}

// Connected groups inside a lane (union-find over the lane's own structural edges; «use»
// dependencies would glue almost everything into one group).
const STRUCTURAL = new Set(['inherits', 'realizes', 'composes', 'aggregates'])
function groupsOf(members, edges) {
  const parent = new Map(members.map((c) => [c.id, c.id]))
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)))
  const inner = edges.filter((e) => STRUCTURAL.has(e.data.kind) && parent.has(e.source) && parent.has(e.target))
  for (const e of inner) parent.set(find(e.source), find(e.target))
  const groups = new Map()
  for (const c of members) {
    const r = find(c.id)
    if (!groups.has(r)) groups.set(r, { members: [], edges: [] })
    groups.get(r).members.push(c)
  }
  for (const e of inner) groups.get(find(e.source)).edges.push(e)
  return [...groups.values()].sort((a, b) => b.members.length - a.members.length)
}

export function layoutClasses(classes, edges) {
  // layout ignores whether «use» edges are shown, so toggling them doesn't move classes
  edges = edges.filter((e) => STRUCTURAL.has(e.data.kind))
  const nodes = []
  let x = 0
  for (const lane of LANES) {
    const members = classes.filter((c) => laneOf(c) === lane)
    if (!members.length) continue
    // Lay out each group, then shelf-pack groups into rows no wider than the widest group
    // (and at least four classes wide), so unrelated classes don't form one endless row.
    const laid = groupsOf(members, edges).map((gr) => layoutGroup(gr.members, gr.edges))
    const maxW = Math.max(4 * NODE_W + 3 * GAP, ...laid.map((l) => l.width))
    let cx = 0
    let cy = 0
    let rowH = 0
    let width = 0
    const placed = []
    for (const l of laid) {
      if (cx > 0 && cx + l.width > maxW) {
        cx = 0
        cy += rowH + GAP * 2
        rowH = 0
      }
      for (const [id, p] of l.pos) placed.push({ id, x: x + cx + p.x, y: cy + p.y })
      width = Math.max(width, cx + l.width)
      cx += l.width + GAP
      rowH = Math.max(rowH, l.height)
    }
    const height = cy + rowH
    nodes.push({
      id: `lane:${lane}`,
      type: 'lane',
      position: { x: x - LANE_PAD, y: -LANE_PAD - 28 },
      data: { lane, count: members.length },
      style: { width: width + LANE_PAD * 2, height: height + LANE_PAD * 2 + 28 },
      draggable: false,
      selectable: false,
      zIndex: -1,
    })
    const byId = new Map(members.map((c) => [c.id, c]))
    for (const p of placed) nodes.push({ id: p.id, type: 'class', position: { x: p.x, y: p.y }, data: { cls: byId.get(p.id) } })
    x += width + LANE_PAD * 2 + LANE_GAP
  }
  return nodes
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, useReactFlow } from '@xyflow/react'
import { Tree, TreeRow } from '../../shell.jsx'
import { ancestors, pathTree, useExpanded } from '../../pathTree.js'
import { Discussion, ThreadBadgeFor, badgeMap } from '../../Threads.jsx'
import { LANES, NODE_W, layoutClasses, nodeHeight, relationEdges, visibleMembers } from './classLayout.js'
import { useDoc } from '../../useDoc.js'
import { tip } from '../../tooltip.jsx'
import { blurField, plainKey } from '../../keys.js'

// Classes view: UML class diagram of the code, swimlanes per Clean Architecture layer, with
// dependency-rule errors and SOLID warnings from the last analysis (classes.json).

const VIS = { public: '+', protected: '#', private: '−' }
const STEREO = { interface: '«interface»', abstract: '«abstract»', dataclass: '«dataclass»', enum: '«enumeration»', model: '«model»' }
const RULE_INFO = {
  DEP: 'Dependency rule',
  SRP: 'Single responsibility',
  OCP: 'Open/closed',
  LSP: 'Liskov substitution',
  ISP: 'Interface segregation',
  DIP: 'Dependency inversion',
}
const SIDES = [
  ['top', Position.Top],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
  ['right', Position.Right],
]

const short = (t) => (t || '').replace(/\b[\w.]+\.(\w+)/g, '$1')

const ClassNode = memo(function ClassNode({ data, selected }) {
  const { cls, findings = [], dim, badge } = data
  const attrs = visibleMembers(cls.attributes)
  const methods = visibleMembers(cls.methods)
  const tone = findings.some((f) => f.severity === 'error') ? 'error' : findings.length ? 'warning' : null
  return (
    <div className={`uml-class k-${cls.kind} ${selected ? 'sel' : ''} ${tone ? `has-${tone}` : ''} ${dim ? 'dim' : ''}`} style={{ width: NODE_W }}>
      {SIDES.map(([id, pos]) => (
        <span key={id}>
          <Handle type="source" id={`s-${id}`} position={pos} />
          <Handle type="target" id={`t-${id}`} position={pos} />
        </span>
      ))}
      <div className="uml-head">
        {STEREO[cls.kind] && <div className="uml-stereo">{STEREO[cls.kind]}</div>}
        <div className={`uml-name ${cls.kind === 'interface' || cls.kind === 'abstract' ? 'italic' : ''}`}>{cls.name}</div>
        {tone && (
          <span className={`uml-flag flag-${tone}`} {...tip(`${findings.length} finding${findings.length > 1 ? 's' : ''}`, { desc: findings.map((f) => `${f.rule}: ${f.message}`).join('\n') })}>
            {findings.length}
          </span>
        )}
        {badge && <ThreadBadgeFor badge={badge} />}
      </div>
      <div className="uml-sec">
        {attrs.items.map((a) => (
          <div key={a.name} className={`uml-row ${a.static ? 'static' : ''}`}>
            {VIS[a.visibility]} {a.name}
            {a.type && <span className="uml-type">: {short(a.type)}</span>}
          </div>
        ))}
        {attrs.more > 0 && <div className="uml-more">+{attrs.more} more</div>}
        {!cls.attributes.length && <div className="uml-row empty"> </div>}
      </div>
      <div className="uml-sec">
        {methods.items.map((m) => (
          <div key={m.name + m.line} className={`uml-row ${m.abstract ? 'abstract' : ''} ${m.static || m.classmethod ? 'static' : ''} ${m.stub && !m.abstract ? 'stub' : ''}`}>
            {VIS[m.visibility]} {m.name}({m.params.map((p) => p.name).join(', ')})
            {m.returns && <span className="uml-type">: {short(m.returns)}</span>}
          </div>
        ))}
        {methods.more > 0 && <div className="uml-more">+{methods.more} more</div>}
        {!cls.methods.length && <div className="uml-row empty"> </div>}
      </div>
    </div>
  )
})

function LaneNode({ data }) {
  return (
    <div className={`uml-lane lane-${data.lane}`}>
      <div className="uml-lane-title">
        {data.lane === 'other' ? 'unmapped' : data.lane} <span>{data.count}</span>
      </div>
    </div>
  )
}

const nodeTypes = { class: ClassNode, lane: LaneNode }

// SVG markers for UML edges, referenced by id from the edges.
function Markers() {
  return (
    <svg className="uml-markers" aria-hidden="true">
      <defs>
        <marker id="uml-triangle" viewBox="0 0 20 20" refX="18" refY="10" markerWidth="16" markerHeight="16" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M2 2 L18 10 L2 18 z" className="mk-hollow" />
        </marker>
        <marker id="uml-arrow" viewBox="0 0 20 20" refX="17" refY="10" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M3 3 L17 10 L3 17" className="mk-open" />
        </marker>
        <marker id="uml-diamond" viewBox="0 0 24 14" refX="1" refY="7" markerWidth="20" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M1 7 L12 1 L23 7 L12 13 z" className="mk-hollow" />
        </marker>
        <marker id="uml-diamond-filled" viewBox="0 0 24 14" refX="1" refY="7" markerWidth="20" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M1 7 L12 1 L23 7 L12 13 z" className="mk-filled" />
        </marker>
      </defs>
    </svg>
  )
}

// Connect each edge on the sides that face each other, after layout.
function routeEdges(edges, nodes) {
  const pos = new Map(nodes.map((n) => [n.id, n]))
  return edges.map((e) => {
    const a = pos.get(e.source)
    const b = pos.get(e.target)
    if (!a || !b) return e
    const dx = b.position.x - a.position.x
    const dy = b.position.y - a.position.y
    const horizontal = Math.abs(dx) > NODE_W * 0.9
    const [s, t] = horizontal ? (dx > 0 ? ['right', 'left'] : ['left', 'right']) : dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
    return { ...e, sourceHandle: `s-${s}`, targetHandle: `t-${t}` }
  })
}

const VERB = { inherits: 'inherits from', realizes: 'implements', composes: 'creates and owns', aggregates: 'is given', depends: 'uses' }

// Laid-out nodes with the user's moved positions applied; lanes grow to fit their classes.
function withMoves(laid, moved) {
  if (!moved || !Object.keys(moved).length) return laid
  const nodes = laid.map((n) => (n.type === 'class' && moved[n.id] ? { ...n, position: moved[n.id] } : n))
  return nodes.map((lane) => {
    if (lane.type !== 'lane') return lane
    const members = nodes.filter((n) => n.type === 'class' && (n.data.cls.layer || 'other') === lane.data.lane)
    if (!members.length) return lane
    const PAD = 36
    const x0 = Math.min(...members.map((n) => n.position.x)) - PAD
    const y0 = Math.min(...members.map((n) => n.position.y)) - PAD - 28
    const x1 = Math.max(...members.map((n) => n.position.x + NODE_W)) + PAD
    const y1 = Math.max(...members.map((n) => n.position.y + nodeHeight(n.data.cls))) + PAD
    return { ...lane, position: { x: x0, y: y0 }, style: { ...lane.style, width: x1 - x0, height: y1 - y0 } }
  })
}

function Diagram({ classes, findingsByClass, badges, selected, onSelect, theme, focusReq, showDepends, moved, onMoved }) {
  const rf = useReactFlow()
  const [hovered, setHovered] = useState(null)
  // Layout depends only on the classes, not on selection or the «use» toggle.
  const laid = useMemo(() => layoutClasses(classes, relationEdges(classes)), [classes])
  const placed = useMemo(() => withMoves(laid, moved), [laid, moved])
  const built = useMemo(() => {
    const edges = relationEdges(classes, { showDepends })
    const near = new Set(selected ? [selected, ...edges.filter((e) => e.source === selected || e.target === selected).flatMap((e) => [e.source, e.target])] : [])
    const nodes = placed.map((n) =>
      n.type === 'class'
        ? { ...n, selected: n.id === selected, data: { ...n.data, findings: findingsByClass.get(n.id), badge: badges[n.id], dim: selected && !near.has(n.id) } }
        : n,
    )
    return { nodes, edges: routeEdges(edges, nodes) }
  }, [classes, placed, findingsByClass, badges, selected, showDepends])

  // Nodes are local state so they follow the pointer while dragged.
  const [nodes, setNodes] = useState(built.nodes)
  useEffect(() => setNodes(built.nodes), [built.nodes])
  const onNodesChange = useCallback((changes) => setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type === 'position' || c.type === 'dimensions'), ns)), [])

  const names = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes])
  const edges = useMemo(
    () =>
      built.edges.map((e) => {
        const hot = e.id === hovered || (selected && (e.source === selected || e.target === selected))
        const label = e.id === hovered ? `${names.get(e.source)} ${VERB[e.data.kind]} ${names.get(e.target)}${e.data.via ? ` · ${e.data.via}` : ''}${e.data.violation ? ' · breaks the dependency rule' : ''}` : undefined
        return hot || label ? { ...e, className: `${e.className} ${hot ? 'hot' : ''}`, label, labelBgPadding: [6, 3], labelBgBorderRadius: 5, zIndex: 5 } : e
      }),
    [built.edges, hovered, selected, names],
  )

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.08, duration: 300 }), 50)
    return () => clearTimeout(t)
  }, [classes.length, rf])

  useEffect(() => {
    const n = focusReq?.id && placed.find((x) => x.id === focusReq.id)
    if (n) rf.setCenter(n.position.x + NODE_W / 2, n.position.y + 120, { zoom: 0.85, duration: 350 })
  }, [focusReq, rf]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => n.type === 'class' && onSelect(n.id)}
      onNodeDragStop={(_, n, dragged) => onMoved(Object.fromEntries((dragged?.length ? dragged : [n]).filter((d) => d.type === 'class').map((d) => [d.id, { x: Math.round(d.position.x), y: Math.round(d.position.y) }])))}
      onEdgeMouseEnter={(_, e) => setHovered(e.id)}
      onEdgeMouseLeave={() => setHovered(null)}
      onPaneClick={() => onSelect(null)}
      nodesConnectable={false}
      deleteKeyCode={null}
      minZoom={0.03}
      maxZoom={2}
      panOnScroll
      zoomOnPinch
      zoomOnScroll={false}
      colorMode={theme}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1.2} color={theme === 'dark' ? '#2a3040' : '#c3c9d5'} />
      <Controls position="bottom-right" showInteractive={false} />
      <MiniMap position="bottom-left" pannable zoomable nodeColor={(n) => (n.type === 'lane' ? 'transparent' : n.data.findings?.length ? '#e5536b' : '#5a60c8')} />
    </ReactFlow>
  )
}

function ClassInspector({ cls, findings, plan, onClose }) {
  return (
    <aside className="inspector">
      <div className="ins-head">
        <div>
          <div className="ins-type">{cls.name}</div>
          <div className="ins-id">
            {STEREO[cls.kind] || 'class'} · {cls.layer || 'no layer'} · {cls.file}:{cls.line}
          </div>
        </div>
        <button className="ins-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="ins-body">
        {findings.length > 0 && (
          <div className="ins-field">
            <span className="ins-label">Findings</span>
            {findings.map((f) => (
              <div key={f.id} className={`finding sev-${f.severity}`}>
                <div className="finding-head">
                  <span className="rule">{f.rule}</span> {RULE_INFO[f.rule]}
                  {f.line !== cls.line && <span className="finding-at">:{f.line}</span>}
                </div>
                <div className="finding-msg">{f.message}</div>
                <div className="finding-hint">{f.hint}</div>
              </div>
            ))}
          </div>
        )}
        {cls.bases.length > 0 && (
          <div className="ins-field">
            <span className="ins-label">Bases</span>
            <div className="mono-list">{cls.bases.map((b) => b.name).join(', ')}</div>
          </div>
        )}
        <div className="ins-field">
          <span className="ins-label">Relations</span>
          {(cls.relations || []).length ? (
            <ul className="rel-list">
              {cls.relations.map((r, i) => (
                <li key={i}>
                  <b>{r.kind}</b> {r.targetName} <span className="via">{r.via}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mono-list">none</div>
          )}
        </div>
        <Discussion view="classes" folder={cls.folder} refId={cls.id} threads={plan.threads} onSend={plan.sendMessage} onStatus={plan.setThreadStatus} />
      </div>
    </aside>
  )
}

const worst = (fs) => (fs.some((f) => f.severity === 'error') ? 'error' : fs.length ? 'warning' : null)

// Side bar tree like the VS Code explorer: layer → folders → .py files → classes. Folders and
// files carry the worst finding inside them (red = dependency rule, amber = SOLID).
function ClassTree({ classes, findingsByClass, selected, onSelect, openAll }) {
  const [isOpen, toggle, reveal] = useExpanded(LANES)
  const byLane = useMemo(() => LANES.map((lane) => [lane, classes.filter((c) => (c.layer || 'other') === lane)]).filter(([, cs]) => cs.length), [classes])

  // Reveal the selected class (picked in the diagram or the findings list).
  useEffect(() => {
    const c = selected && classes.find((x) => x.id === selected)
    if (c) reveal([c.layer || 'other', ...ancestors(c.file).map((p) => `${c.layer || 'other'}:${p}`)])
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const renderLane = ([lane, list]) => {
    const inFile = new Map()
    for (const c of list) inFile.set(c.file, [...(inFile.get(c.file) || []), c])
    for (const cs of inFile.values()) cs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    const findingsIn = (node) =>
      node.leaf ? inFile.get(node.path).flatMap((c) => findingsByClass.get(c.id) || []) : node.kids.flatMap(findingsIn)
    const open = (key) => openAll || isOpen(key)

    const renderNode = (node, depth) => {
      const key = `${lane}:${node.path}`
      const fs = findingsIn(node)
      return (
        <div key={key}>
          <TreeRow
            depth={depth}
            twisty
            open={open(key)}
            label={node.label}
            title={node.path}
            tipDesc={fs.length ? `${fs.filter((f) => f.severity === 'error').length} errors · ${fs.filter((f) => f.severity === 'warning').length} warnings inside` : 'No findings'}
            mono
            tone={worst(fs)}
            count={node.leaf ? inFile.get(node.path).length : undefined}
            onClick={() => toggle(key)}
          />
          {open(key) &&
            (node.leaf
              ? inFile.get(node.path).map((c) => {
                  const cf = findingsByClass.get(c.id) || []
                  return (
                    <TreeRow
                      key={c.id}
                      depth={depth + 1}
                      on={selected === c.id}
                      label={c.name}
                      title={c.name}
                      tipDesc={[
                        `${STEREO[c.kind] || 'class'} · ${c.file}:${c.line}`,
                        `${c.attributes.length} attributes · ${c.methods.length} methods · ${(c.relations || []).length} relations`,
                        ...cf.slice(0, 3).map((f) => `${f.rule}: ${f.message}`),
                        cf.length > 3 ? `+${cf.length - 3} more findings` : null,
                      ]
                        .filter(Boolean)
                        .join('\n')}
                      badge={STEREO[c.kind] ? c.kind.slice(0, 5) : null}
                      tone={worst(cf)}
                      count={cf.length || undefined}
                      onClick={() => onSelect(c.id)}
                    />
                  )
                })
              : node.kids.map((k) => renderNode(k, depth + 1)))}
        </div>
      )
    }

    // No layer mapping yet: everything is "unmapped", so show the folder tree directly.
    if (byLane.length === 1 && lane === 'other') return <div key={lane}>{pathTree([...inFile.keys()], { sort: true }).map((n) => renderNode(n, 0))}</div>

    return (
      <div key={lane} className="tree-group">
        <TreeRow depth={0} twisty open={open(lane)} label={lane === 'other' ? 'unmapped' : lane} count={list.length} tone={worst(list.flatMap((c) => findingsByClass.get(c.id) || []))} onClick={() => toggle(lane)} />
        {open(lane) && pathTree([...inFile.keys()], { sort: true }).map((n) => renderNode(n, 1))}
      </div>
    )
  }

  return <Tree>{byLane.map(renderLane)}</Tree>
}

export function ClassesView({ doc, setDoc, plan, theme, request }) {
  // Classes the user moved by hand, saved in the plan (diagram.json) so they stay put.
  const diagram = useDoc('diagram')
  const moved = diagram.doc?.classes
  const onMoved = useCallback((m) => diagram.save({ ...diagram.doc, classes: { ...moved, ...m } }), [diagram, moved])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [onlyFindings, setOnlyFindings] = useState(false)
  const [showDepends, setShowDepends] = useState(null)
  const [laneFilter, setLaneFilter] = useState(null)
  const [focusReq, setFocusReq] = useState(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/classes/refresh', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || r.statusText)
      setDoc(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [setDoc])

  useEffect(() => {
    if (doc === null && !busy && !error) refresh()
  }, [doc]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((id) => {
    setSelected(id)
    if (id) setFocusReq({ id, n: Date.now() })
  }, [])

  useEffect(() => {
    if (request?.ref) select(request.ref)
  }, [request, select])

  // Keyboard: Esc deselects, / filters, F zooms to the selected class.
  const search = useRef(null)
  const keys = useRef({})
  keys.current = { selected }
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (!blurField(e)) setSelected(null)
      } else if (!plainKey(e)) {
        return
      } else if (e.key === '/') {
        e.preventDefault()
        search.current?.focus()
      } else if (e.key.toLowerCase() === 'f' && keys.current.selected) {
        e.preventDefault()
        setFocusReq({ id: keys.current.selected, n: Date.now() })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const findingsByClass = useMemo(() => {
    const m = new Map()
    for (const f of doc?.findings || []) if (f.classId) m.set(f.classId, [...(m.get(f.classId) || []), f])
    return m
  }, [doc])

  const badges = useMemo(() => badgeMap(plan.threads, null, 'classes'), [plan.threads])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (doc?.classes || []).filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.module.toLowerCase().includes(q)) &&
        (!onlyFindings || findingsByClass.has(c.id)) &&
        (!laneFilter || (c.layer || 'other') === laneFilter),
    )
  }, [doc, query, onlyFindings, findingsByClass, laneFilter])

  // «use» edges clutter big models: off by default above 60 classes.
  const depends = showDepends ?? (doc?.classes?.length || 0) <= 60
  const cls = selected && doc?.classes.find((c) => c.id === selected)
  const sortedFindings = useMemo(() => [...(doc?.findings || [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)), [doc])

  return (
    <>
      <aside className="sidebar">
        <div className="side-title">
          Classes
          <button className="side-action" onClick={refresh} disabled={busy} {...tip('Refresh', { desc: 'Re-extract classes from the code and re-run the checks' })}>
            {busy ? 'Analysing…' : '↻ Refresh'}
          </button>
        </div>
        {error && <div className="side-error">{error}</div>}
        {doc && !doc.layers && <div className="side-note">No layer mapping yet: dependency-rule checks are off. Ask Claude to map the layers.</div>}
        <input ref={search} className="ins-input side-search" placeholder="Filter classes…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter classes" />
        <select className="ins-input side-search" value={laneFilter || ''} onChange={(e) => setLaneFilter(e.target.value || null)} aria-label="Layer shown in the diagram">
          <option value="">All layers</option>
          {LANES.filter((l) => doc?.classes?.some((c) => (c.layer || 'other') === l)).map((l) => (
            <option key={l} value={l}>
              {l === 'other' ? 'Unmapped' : l[0].toUpperCase() + l.slice(1)} only
            </option>
          ))}
        </select>
        <label className="side-check">
          <input type="checkbox" checked={onlyFindings} onChange={(e) => setOnlyFindings(e.target.checked)} /> Only classes with findings
        </label>
        <label className="side-check">
          <input type="checkbox" checked={depends} onChange={(e) => setShowDepends(e.target.checked)} /> Show «use» dependencies
        </label>
        <ClassTree
          classes={visible}
          findingsByClass={findingsByClass}
          selected={selected}
          onSelect={select}
          openAll={!!query.trim() || onlyFindings}
        />
        {sortedFindings.length > 0 && (
          <details className="side-section" open>
            <summary className="side-label">Findings · {sortedFindings.length}</summary>
            <div className="findings">
              {sortedFindings.slice(0, 200).map((f) => (
                <button key={f.id} className={`finding-row sev-${f.severity}`} onClick={() => f.classId && select(f.classId)} {...tip(`${f.rule} · ${f.file}:${f.line}`, { desc: f.hint, side: 'right' })}>
                  <span className="rule">{f.rule}</span>
                  <span className="finding-msg">{f.message}</span>
                </button>
              ))}
            </div>
          </details>
        )}
        <details className="side-section">
          <summary className="side-label">UML notation</summary>
          <div className="legend uml-legend">
            <div className="lg"><span className="lg-uml inherits" />inherits (generalisation)</div>
            <div className="lg"><span className="lg-uml realizes" />implements interface</div>
            <div className="lg"><span className="lg-uml composes" />composition (creates and owns)</div>
            <div className="lg"><span className="lg-uml aggregates" />aggregation (injected)</div>
            <div className="lg"><span className="lg-uml depends" />uses</div>
            <div className="lg"><span className="lg-uml violation" />breaks the dependency rule</div>
            <div className="lg mono">+ public · # protected · − private</div>
          </div>
        </details>
      </aside>

      <main className="editor">
        <div className="canvas">
          <Markers />
          {doc?.classes?.length > 0 && (
            <div className="toolbar">
              <button className="tb-btn" onClick={refresh} disabled={busy} {...tip('Refresh', { desc: 'Re-extract classes from the code and re-run the checks' })}>
                ↻ Refresh
              </button>
              <span className="tb-sep" />
              <button
                className="tb-btn"
                onClick={() => diagram.save({ ...diagram.doc, classes: {} })}
                disabled={!moved || !Object.keys(moved).length}
                {...tip('Tidy layout', { desc: 'Put classes you dragged back into the automatic layout' })}
              >
                Tidy layout
              </button>
              <span className="tb-hint">Drag classes to arrange · hover an arrow for details</span>
            </div>
          )}
          {doc === undefined || (doc === null && busy) ? (
            <div className="empty-state">
              <div className="empty-title">Analysing classes…</div>
            </div>
          ) : !doc?.classes?.length ? (
            <div className="empty-state">
              <div className="empty-title">No classes yet</div>
              <p className="empty-hint">The class diagram is built from the Python code in the plan folders. For a new project it fills in as code is written.</p>
              <div className="empty-actions">
                <button className="ins-btn tone-primary" onClick={refresh} disabled={busy}>Analyse now</button>
              </div>
            </div>
          ) : (
            <ReactFlowProvider>
              <Diagram
                classes={visible}
                findingsByClass={findingsByClass}
                badges={badges}
                selected={selected}
                onSelect={select}
                theme={theme}
                focusReq={focusReq}
                showDepends={depends}
                moved={moved}
                onMoved={onMoved}
              />
            </ReactFlowProvider>
          )}
        </div>
      </main>

      {cls && <ClassInspector cls={cls} findings={findingsByClass.get(cls.id) || []} plan={plan} onClose={() => setSelected(null)} />}
    </>
  )
}

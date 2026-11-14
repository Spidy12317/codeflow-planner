import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, applyNodeChanges, useReactFlow } from '@xyflow/react'
import { nodeTypes, edgeTypes } from './nodes/index.jsx'
import { LAYOUT_VERSION, currentPositions, layoutTab } from './layout.js'
import { LinkContext, LinkInfoContext, EditContext, ThreadsContext } from '../../links.js'
import { Discussion, MessagesPanel, badgeMap } from '../../Threads.jsx'
import { Inspector } from './Inspector.jsx'
import { GenerateDialog } from './Generate.jsx'
import { Tree, TreeRow } from '../../shell.jsx'
import { CommandPalette } from '../../layout.jsx'
import { tip } from '../../tooltip.jsx'
import { blurField, focusField, isTyping } from '../../keys.js'
import { ancestors, pathTree, useExpanded } from '../../pathTree.js'
import { addCounts, explorerTree, fileOf, shownStatus, statusCounts, statusLine } from './planStats.js'
import { Welcome } from './Welcome.jsx'
import { flowChange, flowChangeCounts, onlyDifferingChanges, rollupChange, withoutDone } from '../../../../domain/plan/change.js'
import { layerOf } from '../../../../domain/project/layers.js'
import { indexTab, newFlow, newNote, newPanel, newPs, newRef, newStep, setPsKind, uid } from '../../../../domain/plan/model.js'

// Flows view: explorer tree of folders → files (one directory tree, like VS Code)
// in the side bar, open folders as editor tabs, the flow canvas, and the inspector.

// HTML cards whose height depends on content; everything else is sized by the layout.
const MEASURED = new Set(['step', 'gather', 'ref', 'sticky'])
// Structural helpers that shouldn't show a selection ring of their own.
const UNSELECTABLE = new Set(['junction', 'psgroup'])
// Index entries that sit in a plain list of siblings (↑↓ to step through, ⌥↑↓ to reorder).
const MOVABLE = new Set(['flow', 'spine', 'wrap', 'ps', 'ref', 'note'])

// Minimap and dot-grid colours are SVG attributes (no CSS vars), so pick them per theme.
const CANVAS_COLORS = {
  light: {
    dots: '#c3c9d5',
    mask: 'rgba(230,233,240,0.72)',
    nodes: { frame: '#f5f6fa', sticky: '#ffe57a', panel: '#d6dbe7', tryframe: '#f6d9df', loopframe: '#dcdcfb', ref: '#2b3245', card: '#262a5c' },
  },
  dark: {
    dots: '#2a3040',
    mask: 'rgba(14,16,22,0.72)',
    nodes: { frame: '#1b1f2a', sticky: '#d8c25a', panel: '#2c3242', tryframe: '#3a1a22', loopframe: '#252a4f', ref: '#3a4258', card: '#5a60c8' },
  },
}
const minimapColor = (palette) => (n) =>
  palette[n.type] || (n.type === 'ps' || n.type === 'junction' || n.type === 'psgroup' ? 'transparent' : palette.card)

function FlowCanvas({ tab, focus, theme, selected, onSelect, onMoved }) {
  const colors = CANVAS_COLORS[theme]
  const rf = useReactFlow()
  const sizes = useRef({})
  const [sizeTick, setSizeTick] = useState(0)
  const tickPending = useRef(false)
  const fitted = useRef(false)

  const built = useMemo(() => layoutTab(tab, sizes.current), [tab, sizeTick])
  const typeOf = useMemo(() => Object.fromEntries(built.nodes.map((n) => [n.id, n.type])), [built])
  const [nodes, setNodes] = useState([])

  const markSelected = useCallback(
    (list) =>
      list.map((n) => {
        const on = n.data.ref === selected && !UNSELECTABLE.has(n.type)
        return n.selected === on ? n : { ...n, selected: on }
      }),
    [selected],
  )

  useEffect(() => setNodes(markSelected(built.nodes)), [built]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setNodes((ns) => markSelected(ns)), [markSelected])

  // Re-run layout whenever a content-sized card changes height (edit, collapse, first render).
  const onNodesChange = useCallback(
    (changes) => {
      let grew = false
      for (const c of changes) {
        if (c.type === 'dimensions' && c.dimensions && MEASURED.has(typeOf[c.id])) {
          const h = c.dimensions.height
          if (Math.abs((sizes.current[c.id] ?? -1) - h) > 1) {
            sizes.current[c.id] = h
            grew = true
          }
        }
      }
      if (grew && !tickPending.current) {
        tickPending.current = true
        requestAnimationFrame(() => {
          tickPending.current = false
          setSizeTick((t) => t + 1)
        })
      }
      setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'select' && c.type !== 'remove'), ns))
    },
    [typeOf],
  )

  // focus: { flow } fits a whole flow, { ref } zooms to the node(s) for one plan item.
  const focusOn = useCallback(
    (f) => {
      if (f?.ref) {
        const hits = rf.getNodes().filter((n) => n.data.ref === f.ref && !UNSELECTABLE.has(n.type))
        if (hits.length) return rf.fitView({ nodes: hits.map((n) => ({ id: n.id })), padding: 0.6, maxZoom: 1.1, duration: 350 })
      }
      if (f?.flows?.length) rf.fitView({ nodes: f.flows.map((id) => ({ id: `frame:${id}` })), padding: 0.06, duration: 350 })
      else if (f?.flow) rf.fitView({ nodes: [{ id: `frame:${f.flow}` }], padding: 0.06, duration: 350 })
      else rf.fitView({ padding: 0.06, duration: 350 })
    },
    [rf],
  )

  // First fit once real card heights are in.
  useEffect(() => {
    if (fitted.current || sizeTick === 0) return
    fitted.current = true
    // ?node=<id> deep-links to a single node (e.g. a panel) instead of the whole tab.
    const node = new URLSearchParams(location.search).get('node')
    setTimeout(() => (node ? rf.fitView({ nodes: [{ id: node }], padding: 0.12 }) : focusOn(focus)), 60)
  }, [sizeTick, rf, focusOn, focus])

  useEffect(() => {
    if (fitted.current) focusOn(focus)
  }, [focus, focusOn])

  return (
    <ReactFlow
      nodes={nodes}
      edges={built.edges}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => !UNSELECTABLE.has(n.type) && onSelect(n.data.ref)}
      onPaneClick={() => onSelect(null)}
      onNodeDragStop={(_, n, dragged) => onMoved(dragged?.length ? dragged : [n])}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      deleteKeyCode={null}
      disableKeyboardA11y
      // Selected frames and panels must not jump above the arrows they contain.
      elevateNodesOnSelect={false}
      minZoom={0.05}
      maxZoom={2.5}
      panOnScroll
      zoomOnPinch
      zoomOnScroll={false}
      selectionOnDrag={false}
      colorMode={theme}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1.4} color={colors.dots} />
      <Controls position="bottom-right" showInteractive={false} />
      <MiniMap
        position="bottom-left"
        pannable
        zoomable
        nodeBorderRadius={4}
        nodeColor={minimapColor(colors.nodes)}
        nodeStrokeColor="transparent"
        maskColor={colors.mask}
      />
    </ReactFlow>
  )
}

function Legend() {
  return (
    <div className="legend">
      <div className="side-label">Notation</div>
      <div className="lg"><span className="lg-line spine" />sequence (spine)</div>
      <div className="lg"><span className="lg-line drill" />drill-down to detail</div>
      <div className="lg"><span className="lg-line back" />loop back-edge</div>
      <div className="lg"><span className="lg-line raise" />exception path</div>
      <div className="lg"><span className="lg-sw cond" />condition</div>
      <div className="lg"><span className="lg-sw call" />internal service call</div>
      <div className="lg"><span className="lg-sw ext" />external system call</div>
      <div className="lg"><span className="lg-sw raise" />raise</div>
      <div className="lg"><span className="lg-sw ret" />return</div>
      <div className="lg"><span className="pill pill-await">await</span>awaited call</div>
      <div className="lg"><span className="pill pill-mode">⑂ race</span>parallel tasks + join</div>
      <div className="lg"><span className="lg-sw loop" />loop frame</div>
      <div className="lg"><span className="lg-sw try" />try frame</div>
      <div className="side-label">Planned changes (badge + ring colour; status stays in the pill)</div>
      <div className="lg"><span className="pill chg chg-new">+ NEW</span>adds code</div>
      <div className="lg"><span className="pill chg chg-edit">✎ EDIT</span>changes existing code</div>
      <div className="lg"><span className="pill chg chg-remove">− REMOVE</span>deletes code (hatched, struck through)</div>
      <div className="lg">Shown once: inside a NEW flow nothing repeats it; lines show only a coloured ring</div>
      <div className="lg"><span className="tchange chg-new">A</span><span className="tchange chg-edit">M</span><span className="tchange chg-remove">D</span>the same, on explorer files</div>
    </div>
  )
}

function Toolbar({ plan, onResetPositions, hasPositions, onMethods, onAddFlow, onGenerate }) {
  return (
    <div className="toolbar">
      <button className="tb-btn" onClick={onMethods} {...tip('Go to method', { keys: 'M', desc: 'List the methods in this folder and pan to one' })}>ƒ Methods</button>
      <span className="tb-sep" />
      <button className="tb-btn" onClick={onAddFlow} {...tip('New flow', { keys: '⇧N', desc: 'Draw a flow by hand in this folder' })}>+ New flow</button>
      <button className="tb-btn" onClick={onGenerate} {...tip('Generate from code', { desc: 'Draft flows from the Python entry points in this folder' })}>⟳ Generate</button>
      <span className="tb-sep" />
      <button className="tb-btn" onClick={plan.undo} disabled={!plan.canUndo} {...tip('Undo', { keys: '⌘Z' })}>↶ Undo</button>
      <button className="tb-btn" onClick={plan.redo} disabled={!plan.canRedo} {...tip('Redo', { keys: '⇧⌘Z' })}>↷ Redo</button>
      <span className="tb-sep" />
      <button className="tb-btn" onClick={onResetPositions} disabled={!hasPositions} {...tip('Tidy layout', { desc: 'Drop cards you moved by hand back into the automatic layout' })}>
        Tidy layout
      </button>
    </div>
  )
}


const spineSteps = (spine) => (spine || []).flatMap((it) => (it.kind === 'loop' || it.kind === 'try' ? [it, ...spineSteps(it.body)] : [it]))

// Hover previews for explorer rows.
const STATUS_ORDER = ['proposed', 'approved', 'in_progress', 'done', 'failed']
function flowSummary(fl) {
  const steps = spineSteps(fl.spine)
  const counts = STATUS_ORDER.map((st) => [st, steps.filter((x) => x.status === st).length]).filter(([, n]) => n)
  return [
    fl.entry && `Entry: ${fl.entry}`,
    `${steps.length} step${steps.length === 1 ? '' : 's'}${fl.notes?.length ? ` · ${fl.notes.length} note${fl.notes.length === 1 ? '' : 's'}` : ''}`,
    counts.length ? counts.map(([st, n]) => `${n} ${st.replace('_', ' ')}`).join(' · ') : null,
    fl.origin === 'generated' ? 'Generated from code (refreshed by sync)' : 'Drawn by hand (sync never overwrites it)',
  ]
    .filter(Boolean)
    .join('\n')
}


const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true })


// What a folder draws when nothing was picked: its first file in explorer order (or its
// first flow without a file). Also used when a remembered file has no flows any more.
function shownFor(folder, tab, picked) {
  const flows = tab?.flows || []
  if (picked && flows.some((fl) => (picked.file ? fileOf(folder, fl) === picked.file : fl.id === picked.flow))) return picked
  const files = flows.map((fl) => fileOf(folder, fl)).filter(Boolean)
  let node = pathTree([...new Set(files)], { sort: true })[0]
  while (node && !node.leaf) node = node.kids[0]
  if (node) return { file: node.path }
  return flows[0] ? { flow: flows[0].id } : null
}

function Explorer({ project, tabs, active, sel, shownBy, revealReq, onPick, onShowFile, onAddFlow, onGenerate }) {
  // Expanded directories / folders by path. The active folder and its parents start open.
  const [isOpen, toggle, reveal] = useExpanded(active ? ancestors(active) : [])
  useEffect(() => {
    if (active) reveal(ancestors(active))
  }, [active, reveal])
  useEffect(() => {
    if (revealReq) reveal(ancestors(revealReq.path))
  }, [revealReq, reveal])

  const flowStatus = useMemo(() => {
    const m = new Map()
    for (const t of Object.values(tabs)) for (const fl of t.flows || []) m.set(fl.id, statusCounts(fl))
    return m
  }, [tabs])
  const folderStatus = (node) => addCounts([...(node.leaf ? (tabs[node.path]?.flows || []).map((fl) => flowStatus.get(fl.id) || {}) : []), ...node.kids.map(folderStatus)])
  // A file or folder's letter counts each flow by its own change (a new flow that also edits a
  // model elsewhere is still a new file), falling back to what's inside it. Done changes don't count.
  const changesOf = flowChangeCounts
  const flowsUnder = (node) => [...(node.leaf ? tabs[node.path]?.flows || [] : []), ...node.kids.flatMap(flowsUnder)]
  const changeLine = (c) => ['new', 'edit', 'remove'].filter((k) => c[k]).map((k) => `${c[k]} flow${c[k] === 1 ? '' : 's'} ${k === 'new' ? 'new' : k === 'edit' ? 'edited' : 'removed'}`).join(' · ')
  const withStatus = (desc, c, ch = {}) =>
    [statusLine(c) && `Status: ${statusLine(c)}`, changeLine(ch) && `Planned: ${changeLine(ch)}`, desc].filter(Boolean).join('\n')

  const flowCount = (node) => (node.leaf ? tabs[node.path]?.flows?.length || 0 : 0) + node.kids.reduce((n, k) => n + flowCount(k), 0)

  // Reveal the file the canvas is drawing, and the file of whatever is selected.
  const shown = active ? shownFor(active, tabs[active], shownBy[active]) : null
  const shownFile = shown?.file ?? null
  useEffect(() => {
    if (shownFile) reveal([...ancestors(active), ...ancestors(shownFile).map((p) => `${active}::${p}`)])
  }, [active, shownFile, reveal])
  useEffect(() => {
    const flow = sel && active && tabs[active] ? indexTab(tabs[active]).get(sel)?.flow : null
    const file = flow && fileOf(active, flow)
    if (file) reveal([...ancestors(active), ...ancestors(file).map((p) => `${active}::${p}`)])
  }, [sel, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // A flow with no entry file yet (a hand-drawn draft) has no file row, so it gets its own.
  const renderFlow = (folder, fl, depth) => (
    <TreeRow
      key={fl.id}
      depth={depth}
      on={folder === active && shownFile == null && shownFor(folder, tabs[folder], shownBy[folder])?.flow === fl.id}
      label={fl.title}
      title={fl.title}
      tipDesc={flowSummary(fl)}
      status={shownStatus(flowStatus.get(fl.id) || {})}
      change={flowChange(fl)}
      onClick={() => onPick({ folder, flow: fl.id, ref: fl.id })}
    />
  )

  // Inside a folder: its files (as a tree). A file row draws that file's flows on the canvas;
  // the flows themselves are not listed (pan the canvas, or press M to jump to one).
  const renderFlows = (folder, depth) => {
    const flows = tabs[folder]?.flows || []
    const byFile = new Map()
    const loose = []
    for (const fl of flows) {
      const file = fileOf(folder, fl)
      if (file) byFile.set(file, [...(byFile.get(file) || []), fl])
      else loose.push(fl)
    }
    for (const list of [...byFile.values(), loose]) list.sort(byTitle)
    const renderFile = (node, d) => {
      const key = `${folder}::${node.path}`
      const open = isOpen(key)
      const flowsIn = node.leaf ? byFile.get(node.path) : [...byFile.keys()].filter((f) => f.startsWith(`${node.path}/`)).flatMap((f) => byFile.get(f))
      const count = flowsIn.length
      const changes = addCounts(flowsIn.map((fl) => flowStatus.get(fl.id) || {}))
      const kinds = changesOf(flowsIn)
      return (
        <div key={key}>
          <TreeRow
            depth={d}
            twisty={!node.leaf}
            open={open}
            icon={node.leaf ? 'file' : open ? 'folder-open' : 'folder'}
            mono={node.leaf}
            label={node.label}
            title={`${folder}/${node.path}`}
            tipDesc={withStatus(`${count} flow${count === 1 ? '' : 's'}${node.leaf ? '\nClick to draw them on the canvas · M to jump to one' : ''}`, changes, kinds)}
            change={rollupChange(kinds)}
            status={shownStatus(changes)}
            on={node.leaf && folder === active && shownFile === node.path}
            count={node.leaf ? count : undefined}
            onTwisty={() => toggle(key)}
            onClick={() => (node.leaf ? onShowFile(folder, node.path) : toggle(key))}
          />
          {open && !node.leaf && node.kids.map((k) => renderFile(k, d + 1))}
        </div>
      )
    }
    return (
      <>
        {pathTree([...byFile.keys()], { sort: true }).map((n) => renderFile(n, depth))}
        {loose.map((fl) => renderFlow(folder, fl, depth))}
      </>
    )
  }

  const renderNode = (node, depth) => {
    const open = isOpen(node.path)
    const count = flowCount(node)
    const folder = node.leaf ? node.path : null
    const changes = folderStatus(node)
    const kinds = changesOf(flowsUnder(node))
    const layer = folder && project?.layers ? layerOf(project.layers, folder) : null
    return (
      <div key={node.path}>
        <TreeRow
          depth={depth}
          twisty
          open={open}
          icon={open ? 'folder-open' : 'folder'}
          muted={!count}
          label={node.label}
          title={node.path}
          tipDesc={withStatus(folder ? `${layer ? `Layer: ${layer}\n` : ''}${count} flow${count === 1 ? '' : 's'}${tabs[folder]?.purpose ? `\n${tabs[folder].purpose}` : ''}\nClick to expand · click a file to draw it` : `${count} flows inside`, changes, kinds)}
          change={rollupChange(kinds)}
          status={shownStatus(changes)}
          count={folder ? count || '–' : undefined}
          tools={
            folder && [
              { icon: '+', label: 'New flow', keys: '⇧N', run: () => onAddFlow(folder) },
              { icon: '⟳', label: 'Generate from code', run: () => onGenerate(folder) },
            ]
          }
          onTwisty={() => toggle(node.path)}
          onClick={() => toggle(node.path)}
        />
        {open && (
          <>
            {node.kids.map((k) => renderNode(k, depth + 1))}
            {folder && renderFlows(folder, depth + 1)}
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <Tree>
        {explorerTree(project).map((n) => renderNode(n, 0))}
      </Tree>
      <details className="side-section">
        <summary className="side-label">Notation</summary>
        <Legend />
      </details>
    </>
  )
}

// Open folders as tabs. Drag to reorder; middle-click or × to close.
function EditorTabs({ open, active, fileLabel, onActivate, onHome, onClose, onReorder }) {
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null)
  return (
    <div className="editor-tabs" role="tablist">
      <button role="tab" aria-selected={!active} aria-label="Overview" className={`etab etab-home ${!active ? 'on' : ''}`} onClick={onHome} {...tip('Overview', { desc: 'Plan status, what needs review, folders and shortcuts', side: 'bottom' })}>
        ⌂
      </button>
      {open.map((f) => (
        <div
          key={f}
          role="tab"
          aria-selected={f === active}
          className={`etab ${f === active ? 'on' : ''} ${drag === f ? 'dragging' : ''} ${over === f && drag !== f ? 'drop-before' : ''}`}
          onClick={() => onActivate(f)}
          onAuxClick={(e) => e.button === 1 && onClose(f)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', f)
            setDrag(f)
          }}
          onDragOver={(e) => {
            if (!drag) return
            e.preventDefault()
            setOver(f)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (drag && drag !== f) onReorder(drag, f)
            setDrag(null)
            setOver(null)
          }}
          onDragEnd={() => {
            setDrag(null)
            setOver(null)
          }}
          {...tip(f, { desc: 'Drag to reorder · middle-click to close', side: 'bottom' })}
        >
          <span className="etab-name">{f.split('/').pop()}</span>
          {fileLabel(f) && <span className="etab-file">› {fileLabel(f)}</span>}
          <button
            className="etab-close"
            aria-label={`Close ${f}`}
            onClick={(e) => {
              e.stopPropagation()
              onClose(f)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

// side: 'explorer' | 'messages'. request: { folder?, ref?, flow?, n } navigation from other views.
export function FlowsView({ plan, theme, side, request, findings, onNavigate, onView }) {
  const { project, tabs, update } = plan
  const folders = project?.folders || []
  const [active, setActiveRaw] = useState(() => decodeURIComponent(location.hash.slice(1)) || null)
  const [openTabs, setOpenTabs] = useState([])
  const [focus, setFocus] = useState(null)
  const [sel, setSel] = useState(null)
  const [genOpen, setGenOpen] = useState(false)
  const [methodsOpen, setMethodsOpen] = useState(false)
  const [revealReq, setRevealReq] = useState(null) // { path } to expand in the explorer
  const tab = tabs[active]

  // What the canvas draws, per folder: { file } or { flow } (a flow with no entry file yet).
  // A folder on its own draws nothing until a file is picked.
  const [shownBy, setShownBy] = useState({})
  const shown = active ? shownFor(active, tab, shownBy[active]) : null
  const show = useCallback((folder, what) => setShownBy((m) => ({ ...m, [folder]: what })), [])
  const showFlowOf = useCallback(
    (folder, fl) => {
      const file = fileOf(folder, fl)
      show(folder, file ? { file } : { flow: fl.id })
    },
    [show],
  )
  const shownKey = shown ? (shown.file ? `file:${shown.file}` : `flow:${shown.flow}`) : null
  const canvasTab = useMemo(() => {
    if (!tab || !shown) return null
    const flows = tab.flows.filter((fl) => (shown.file ? fileOf(active, fl) === shown.file : fl.id === shown.flow))
    return flows.length ? { ...tab, flows: flows.map((fl) => onlyDifferingChanges(withoutDone(fl))) } : null
  }, [tab, shownKey, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // Whatever gets selected (explorer, ⌘K, messages, new flow) is drawn: switch to its file.
  useEffect(() => {
    if (!sel || !tab) return
    const fl = indexTab(tab).get(sel)?.flow
    if (fl && !canvasTab?.flows.some((x) => x.id === fl.id)) showFlowOf(active, fl)
  }, [sel, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a folder also opens it as an editor tab.
  const setActive = useCallback((f) => {
    setActiveRaw(f)
    if (f) setOpenTabs((o) => (o.includes(f) ? o : [...o, f]))
  }, [])

  // Start on the overview, unless the URL names a folder (a reload). No folder open (all tabs
  // closed, or ⌂) shows the overview too.
  useEffect(() => {
    if (active && !openTabs.includes(active)) setActive(active)
  }, [folders, active]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    history.replaceState(null, '', `${location.search}${active ? `#${encodeURIComponent(active)}` : ''}`)
  }, [active])

  // Navigation from other views (messages, execution task refs).
  useEffect(() => {
    if (!request) return
    if (request.folder) setActive(request.folder)
    if (request.ref) setSel(request.ref)
    setFocus({ ref: request.ref, flow: request.flow, n: Date.now() })
  }, [request, setActive])

  const onLink = useCallback(
    (link) => {
      setActive(link.tab)
      setSel(null)
      const fl = link.flow && tabs[link.tab]?.flows.find((x) => x.id === link.flow)
      if (fl) showFlowOf(link.tab, fl)
      setFocus({ flow: link.flow, n: Date.now() })
    },
    [setActive, tabs, showFlowOf],
  )

  // Link tags name the target flow's file; a link to a folder (or a missing flow) names the folder.
  const linkInfo = useCallback(
    (link) => {
      const folder = link.tab.split('/').pop()
      const fl = link.flow && tabs[link.tab]?.flows.find((x) => x.id === link.flow)
      if (!fl) return { label: folder, path: link.tab, title: link.flow ? `${link.tab} › ${link.flow} (flow not found)` : link.tab }
      const file = fileOf(link.tab, fl)
      return file
        ? { label: file.split('/').pop(), path: file, title: `${fl.title}\n${link.tab}/${file}` }
        : { label: folder, path: link.tab, title: `${fl.title}\n${link.tab}` }
    },
    [tabs],
  )

  const closeTab = (f) => {
    const rest = openTabs.filter((x) => x !== f)
    setOpenTabs(rest)
    if (f === active) {
      setActiveRaw(rest.at(-1) || null)
      setSel(null)
    }
  }

  const index = useMemo(() => (tab ? indexTab(tab) : new Map()), [tab])
  const entry = sel ? index.get(sel) : null
  const badges = useMemo(() => badgeMap(plan.threads, active), [plan.threads, active])

  const openThread = useCallback(
    (t) => {
      if (t.view && t.view !== 'flows') return onNavigate({ view: t.view, folder: t.folder, ref: t.ref })
      if (t.folder) setActive(t.folder)
      if (t.ref) {
        setSel(t.ref)
        setFocus({ ref: t.ref, n: Date.now() })
      }
    },
    [onNavigate, setActive],
  )

  // Edit actions for the selected item. `u` returns the id to select afterwards, if any.
  const act = useMemo(() => {
    const u = (fn, coalesce) => {
      const next = update(active, (t, idx) => {
        const e = idx.get(sel)
        return e ? fn(e, t) : undefined
      }, coalesce)
      if (next) setSel(next)
    }
    const insertAt = (e, where, item) => {
      const i = e.arr.indexOf(e.obj)
      e.arr.splice(where === 'after' ? i + 1 : i, 0, item)
      return item.id
    }
    return {
      patch: (fields, coalesce) =>
        u((e) => {
          for (const [k, v] of Object.entries(fields)) {
            if (v === undefined || v === '' || v === false) delete e.obj[k]
            else e.obj[k] = v
          }
        }, coalesce),
      setPsKind: (k) => u((e) => setPsKind(e.obj, k)),
      setStepKind: (k) =>
        u((e) => {
          e.obj.kind = k
          if (k === 'gather') {
            e.obj.mode ??= 'gather'
            e.obj.tasks ??= [{ k: 'call', t: 'task()' }]
          }
        }),
      insertPs: (where) => u((e) => insertAt(e, where, newPs())),
      insertStep: (where) => u((e) => insertAt(e, where, newStep())),
      addChild: (key) =>
        u((e) => {
          const n = newPs()
          ;(e.obj[key] ??= []).push(n)
          return n.id
        }),
      move: (dir) =>
        u((e) => {
          const a = e.arr
          const i = a.indexOf(e.obj)
          const j = i + dir
          if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]
        }),
      remove: () => {
        u((e) => {
          if (e.type === 'panel') {
            e.owner.details = e.owner.details.filter((d) => d !== e.obj)
            if (!e.owner.details.length) delete e.owner.details
          } else {
            e.arr.splice(e.arr.indexOf(e.obj), 1)
          }
        })
        setSel(null)
      },
      addPanel: (side) =>
        u((e) => {
          ;(e.obj.details ??= []).push(newPanel(side))
          return `${e.obj.id}:${side}`
        }),
      addNote: () =>
        u((e) => {
          const n = newNote(e.obj.id)
          ;(e.flow.notes ??= []).push(n)
          return n.id
        }),
      wrap: (kind) =>
        u((e) => {
          const w =
            kind === 'try'
              ? { id: uid('s'), kind: 'try', header: '', body: [e.obj], except: { label: 'Exception', title: 'except Exception', items: [newPs()] } }
              : { id: uid('s'), kind: 'loop', header: 'for item in items', body: [e.obj] }
          e.arr.splice(e.arr.indexOf(e.obj), 1, w)
          return w.id
        }),
      unwrap: () => {
        u((e) => {
          e.arr.splice(e.arr.indexOf(e.obj), 1, ...(e.obj.body || []))
        })
        setSel(null)
      },
      toggleCollapse: () =>
        u((e) => {
          if (e.obj.collapsed) delete e.obj.collapsed
          else e.obj.collapsed = true
        }),
      flowAdd: (what) =>
        u((e) => {
          const f = e.obj
          if (what === 'step') {
            const s = newStep()
            f.spine.push(s)
            return s.id
          }
          if (what === 'note') {
            const n = newNote(f.spine.at(-1)?.id)
            ;(f.notes ??= []).push(n)
            return n.id
          }
          const r = newRef()
          ;(f.refs ??= []).push(r)
          return r.id
        }),
    }
  }, [active, sel, update])

  const edit = useMemo(
    () => ({
      toggleCollapse: (ref) =>
        update(active, (t, idx) => {
          const e = idx.get(ref)
          if (!e) return
          if (e.obj.collapsed) delete e.obj.collapsed
          else e.obj.collapsed = true
        }),
    }),
    [active, update],
  )

  const onMoved = useCallback(
    (moved) =>
      update(active, (t) => {
        // offsets from an older layout no longer mean anything: start fresh
        if (!currentPositions(t)) t.positions = {}
        t.positionsLayout = LAYOUT_VERSION
        for (const n of moved) {
          const lp = n.data._lp
          const dx = n.position.x - lp.x
          const dy = n.position.y - lp.y
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) delete t.positions[n.id]
          else t.positions[n.id] = { dx: Math.round(dx), dy: Math.round(dy) }
        }
        if (!Object.keys(t.positions).length) {
          delete t.positions
          delete t.positionsLayout
        }
      }),
    [active, update],
  )

  const addFlow = (folder = active) => {
    const f = newFlow()
    update(folder, (t) => {
      t.folder = folder
      t.flows.push(f)
    })
    setSel(f.id)
    setFocus({ flow: f.id, n: Date.now() })
  }

  // Generated flows replace flows with the same id (same entry point) and append the rest. Undoable.
  const applyGenerated = (flows) => {
    update(active, (t) => {
      t.folder = active
      for (const f of flows) {
        const i = t.flows.findIndex((x) => x.id === f.id)
        if (i > -1) t.flows[i] = f
        else t.flows.push(f)
      }
    })
    setGenOpen(false)
    setSel(null)
    if (flows[0]) {
      showFlowOf(active, flows[0])
      setFocus({ flow: flows[0].id, n: Date.now() })
    }
  }

  // A note on the selected item's flow, anchored to its step; with nothing selected, on the
  // first flow. Opens the note's text for typing.
  const addNote = () => {
    const id = update(active, (t, idx) => {
      const e = sel && idx.get(sel)
      const flow = e?.flow || t.flows[0]
      if (!flow) return
      const anchor = e?.type === 'spine' || e?.type === 'wrap' ? e.obj.id : e?.owner?.id || (e?.type === 'note' && e.obj.anchor) || flow.spine.at(-1)?.id
      const n = newNote(anchor)
      ;(flow.notes ??= []).push(n)
      return n.id
    })
    if (!id) return
    setSel(id)
    setFocus({ ref: id, n: Date.now() })
    focusField(`ins-${id}-text`)
  }

  // Go to method (M): every flow in the folder, the file on the canvas first. Picking one
  // draws its file if needed and pans to it without opening the inspector.
  const methodItems = useMemo(() => {
    if (!methodsOpen || !tab) return []
    const here = shown?.file
    const list = tab.flows.map((fl) => ({ fl, file: fileOf(active, fl) }))
    list.sort((a, b) => (b.file === here) - (a.file === here) || (a.file || '').localeCompare(b.file || '') || byTitle(a.fl, b.fl))
    return list.map(({ fl, file }) => ({
      id: fl.id,
      label: fl.title,
      hint: file ? `${file}${file === here ? ' · on canvas' : ''}` : 'no file yet',
      run: () => {
        showFlowOf(active, fl)
        setSel(null)
        setFocus({ flow: fl.id, n: Date.now() })
      },
    }))
  }, [methodsOpen, tab, shown?.file, active, showFlowOf])

  // Keyboard: the Flows group in keys.js (SHORTCUTS).
  const keys = useRef({})
  keys.current = { plan, act, sel, entry, active, openTabs, genOpen, tabFlows: tab?.flows, setActive, addFlow, addNote }
  useEffect(() => {
    const select = (id, flow) => {
      setSel(id)
      setFocus(flow ? { flow: id, n: Date.now() } : { ref: id, n: Date.now() })
    }
    const onKey = (e) => {
      const { plan, act, sel, entry, active, openTabs, genOpen, tabFlows, setActive, addFlow, addNote } = keys.current
      if (e.key === 'Escape') {
        if (genOpen) setGenOpen(false)
        else if (!blurField(e)) setSel(null)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !isTyping(e)) {
        e.preventDefault()
        const folder = e.shiftKey ? plan.redo() : plan.undo()
        if (folder) setActive(folder)
        return
      }
      if (genOpen || !active || isTyping(e) || e.metaKey || e.ctrlKey) return
      const vertical = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      if (e.altKey) {
        if (vertical && entry && MOVABLE.has(entry.type)) {
          e.preventDefault()
          act.move(vertical)
        }
        return
      }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (vertical) {
        e.preventDefault()
        if (!entry) {
          const first = tabFlows?.[0]
          if (first) select(first.id, true)
        } else if (MOVABLE.has(entry.type)) {
          const next = entry.arr[entry.arr.indexOf(entry.obj) + vertical]
          if (next) select(next.id, entry.type === 'flow')
        }
      } else if (key === 'ArrowLeft' && entry && entry.type !== 'flow') {
        e.preventDefault()
        select(entry.flow.id, true)
      } else if (key === 'ArrowRight' && entry) {
        const first = entry.type === 'flow' ? entry.obj.spine?.[0] : entry.type === 'wrap' ? entry.obj.body?.[0] : null
        if (first) (e.preventDefault(), select(first.id))
      } else if ((key === 'Delete' || key === 'Backspace') && entry && entry.type !== 'flow' && entry.type !== 'except') {
        e.preventDefault()
        act.remove()
      } else if (key === 'm') {
        e.preventDefault()
        setMethodsOpen(true)
      } else if (key === 'n') {
        e.preventDefault()
        if (e.shiftKey) addFlow()
        else addNote()
      } else if (key === 's' && entry && (entry.type === 'spine' || entry.type === 'wrap' || entry.type === 'flow')) {
        e.preventDefault()
        if (entry.type === 'flow') act.flowAdd('step')
        else act.insertStep('after')
      } else if (key === 'Enter' && entry && !e.target.closest?.('button, a, [role="treeitem"], [role="tab"]')) {
        e.preventDefault()
        const field = document.querySelector('.inspector .ins-body .ins-input')
        field?.focus()
        field?.select?.()
      } else if (key === 'c' && sel) {
        e.preventDefault()
        document.getElementById(`composer-${sel}`)?.focus()
      } else if (key === 'f') {
        e.preventDefault()
        setFocus(!sel ? { n: Date.now() } : entry?.type === 'flow' ? { flow: sel, n: Date.now() } : { ref: sel, n: Date.now() })
      } else if ((key === '[' || key === ']') && openTabs.length > 1) {
        e.preventDefault()
        const i = openTabs.indexOf(active)
        setActiveRaw(openTabs[(i + (key === ']' ? 1 : -1) + openTabs.length) % openTabs.length])
        setSel(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <LinkContext.Provider value={onLink}>
      <LinkInfoContext.Provider value={linkInfo}>
      <EditContext.Provider value={edit}>
        <ThreadsContext.Provider value={badges}>
          <aside className="sidebar">
            <div className="side-title">{side === 'messages' ? 'Messages' : 'Explorer'}</div>
            {side === 'messages' ? (
              <MessagesPanel threads={plan.threads} tabs={tabs} onOpen={openThread} onSend={plan.sendMessage} onStatus={plan.setThreadStatus} />
            ) : (
              <Explorer
                project={project}
                tabs={tabs}
                active={active}
                sel={sel}
                revealReq={revealReq}
                onPick={({ folder, flow, ref }) => {
                  if (folder !== active) setActive(folder)
                  setSel(ref)
                  setFocus(flow ? { flow, n: Date.now() } : { ref, n: Date.now() })
                }}
                shownBy={shownBy}
                onShowFile={(folder, file) => {
                  if (folder !== active) setActive(folder)
                  setSel(null)
                  show(folder, { file })
                  setFocus(null)
                }}
                onAddFlow={(f) => {
                  setActive(f)
                  addFlow(f)
                }}
                onGenerate={(f) => {
                  setActive(f)
                  setGenOpen(true)
                }}
              />
            )}
          </aside>

          <main className="editor">
            <EditorTabs
              open={openTabs}
              active={active}
              fileLabel={(f) => shownFor(f, tabs[f], shownBy[f])?.file?.split('/').pop()}
              onActivate={(f) => {
                setActiveRaw(f)
                setSel(null)
              }}
              onHome={() => {
                setActiveRaw(null)
                setSel(null)
              }}
              onClose={closeTab}
              onReorder={(from, before) =>
                setOpenTabs((o) => {
                  const rest = o.filter((x) => x !== from)
                  rest.splice(rest.indexOf(before), 0, from)
                  return rest
                })
              }
            />
            <div className="canvas">
              {active && (
                <Toolbar
                  plan={plan}
                  hasPositions={!!currentPositions(tab)}
                  onMethods={() => setMethodsOpen(true)}
                  onAddFlow={() => addFlow()}
                  onGenerate={() => setGenOpen(true)}
                  onResetPositions={() =>
                    update(active, (t) => {
                      delete t.positions
                      delete t.positionsLayout
                    })
                  }
                />
              )}
              {methodsOpen && (
                <CommandPalette items={methodItems} placeholder={`Go to a method in ${active}…`} onClose={() => setMethodsOpen(false)} />
              )}
              {genOpen && (
                <GenerateDialog
                  folder={active}
                  existingIds={new Set((tab?.flows || []).map((f) => f.id))}
                  onGenerate={applyGenerated}
                  onClose={() => setGenOpen(false)}
                />
              )}
              {!active ? (
                <Welcome
                  project={project}
                  tabs={tabs}
                  threads={plan.threads}
                  findings={findings}
                  onView={onView}
                  onOpenFolder={(f) => setRevealReq({ path: f, n: Date.now() })}
                  onOpenFlow={(f, fl) => {
                    setActive(f)
                    setSel(null)
                    showFlowOf(f, fl)
                    setFocus({ flow: fl.id, n: Date.now() })
                  }}
                />
              ) : canvasTab ? (
                <ReactFlowProvider key={`${active}::${shownKey}`}>
                  <FlowCanvas tab={canvasTab} focus={focus} theme={theme} selected={sel} onSelect={setSel} onMoved={onMoved} />
                </ReactFlowProvider>
              ) : (
                <div className="empty-state">
                  <div className="empty-title">{active}</div>
                  <p>No flows drawn for this folder yet.</p>
                  {tab?.purpose && <p className="empty-hint">{tab.purpose}</p>}
                  <p className="empty-hint">A flow lives in the folder of its entry point.</p>
                  <div className="empty-actions">
                    <button className="ins-btn tone-primary" onClick={() => setGenOpen(true)}>Generate from code</button>
                    <button className="ins-btn" onClick={() => addFlow()}>Draw a flow by hand</button>
                  </div>
                </div>
              )}
            </div>
          </main>

          {entry && (
            <Inspector key={sel} refId={sel} entry={entry} folders={folders} act={act} onClose={() => setSel(null)}>
              <Discussion folder={active} refId={sel} threads={plan.threads} onSend={plan.sendMessage} onStatus={plan.setThreadStatus} />
            </Inspector>
          )}
        </ThreadsContext.Provider>
      </EditContext.Provider>
      </LinkInfoContext.Provider>
    </LinkContext.Provider>
  )
}

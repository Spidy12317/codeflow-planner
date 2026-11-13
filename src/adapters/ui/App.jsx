import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlan } from './usePlan.js'
import { useDoc } from './useDoc.js'
import { THEMES, useTheme } from './useTheme.js'
import { loadFonts } from './views/flows/measure.js'
import { ActivityBar, SettingsMenu, StatusBar, VIEW_INFO } from './shell.jsx'
import { TooltipLayer } from './tooltip.jsx'
import { CommandPalette, Resizer, ShortcutsHelp, usePersisted } from './layout.jsx'
import { plainKey } from './keys.js'
import { threadState } from './Threads.jsx'
import { FlowsView } from './views/flows/FlowsView.jsx'
import { ClassesView } from './views/classes/ClassesView.jsx'
import { ExecutionView } from './views/execution/ExecutionView.jsx'

// Workbench shell, laid out like VS Code: activity bar | side bar | editor | inspector,
// status bar below. The Execution view stays hidden until it is asked for (settings menu,
// ?view=execution, or Claude revealing it).

const VIEWS = ['flows', 'classes', 'messages', 'execution']
const SIDE = { min: 180, max: 560, initial: 280 }
const INSPECTOR = { min: 280, max: 640, initial: 340 }
const ACTIVITY_W = 48
const emptyExecution = { visible: false, orchestrator: { notes: '' }, agents: [], tasks: [] }

function useView() {
  const [view, setView] = useState(() => {
    const v = new URLSearchParams(location.search).get('view')
    return VIEWS.includes(v) ? v : 'flows'
  })
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    q.set('view', view)
    history.replaceState(null, '', `?${q}${location.hash}`)
  }, [view])
  return [view, setView]
}

export default function App() {
  const plan = usePlan()
  const { mode, setMode, resolved } = useTheme()
  const [view, setView] = useView()
  const [fontsReady, setFontsReady] = useState(false)
  const classes = useDoc('classes')
  const execution = useDoc('execution')
  const [requests, setRequests] = useState({})
  const asked = useMemo(() => new URLSearchParams(location.search).get('view') === 'execution', [])
  const [sideW, setSideW] = usePersisted('side-width', SIDE.initial)
  const [inspW, setInspW] = usePersisted('inspector-width', INSPECTOR.initial)
  const [sideHidden, setSideHidden] = usePersisted('side-hidden', false)
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    loadFonts().then(() => setFontsReady(true))
  }, [])

  const execDoc = execution.doc || emptyExecution
  const execVisible = !!execDoc.visible || asked
  useEffect(() => {
    if (view === 'execution' && execution.doc !== undefined && !execVisible) setView('flows')
  }, [view, execVisible, execution.doc, setView])
  // Claude revealed the plan while the canvas is open: jump to it.
  const wasVisible = useRef(null)
  useEffect(() => {
    const v = execution.doc?.visible
    if (execution.doc === undefined) return
    if (wasVisible.current === false && v) setView('execution')
    wasVisible.current = !!v
  }, [execution.doc, setView])

  // Cross-view navigation: { view, folder?, ref?, flow? }
  const navigate = useCallback(
    (to) => {
      const target = to.view === 'messages' ? 'flows' : to.view
      setView(target)
      setRequests((r) => ({ ...r, [target]: { ...to, n: Date.now() } }))
    },
    [setView],
  )

  const findings = classes.doc
    ? { errors: classes.doc.findings.filter((f) => f.severity === 'error').length, warnings: classes.doc.findings.filter((f) => f.severity === 'warning').length }
    : null
  const waiting = plan.threads.filter((t) => threadState(t) === 'waiting').length
  const replied = plan.threads.filter((t) => threadState(t) === 'replied').length

  // Clicking the active view toggles the side bar, like VS Code.
  const onView = useCallback(
    (v) => {
      if (v === view) setSideHidden((h) => !h)
      else {
        setView(v)
        setSideHidden(false)
      }
    },
    [view, setView, setSideHidden],
  )

  const refreshClasses = useCallback(async () => {
    const r = await fetch('/api/classes/refresh', { method: 'POST' })
    if (r.ok) classes.setDoc(await r.json())
  }, [classes])

  const toggleExecution = useCallback(() => {
    const visible = !execDoc.visible
    execution.save({ ...execDoc, visible })
    setView(visible ? 'execution' : 'flows')
  }, [execDoc, execution, setView])

  // Global shortcuts: ⌘K palette, ⌘1–4 views, ⌘B side bar, ? shortcut list.
  const keys = useRef({})
  keys.current = { onView, execVisible }
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '?' && plainKey(e)) {
        e.preventDefault()
        setHelp(true)
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'k' || (k === 'p' && e.shiftKey)) {
        e.preventDefault()
        setPalette((p) => !p)
      } else if (k === 'b') {
        e.preventDefault()
        setSideHidden((h) => !h)
      } else if (/^[1-4]$/.test(k)) {
        const v = VIEWS[Number(k) - 1]
        if (v === 'execution' && !keys.current.execVisible) return
        e.preventDefault()
        setView(v)
        setSideHidden(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, setSideHidden])

  // Everything the palette can jump to or run.
  const paletteItems = useMemo(() => {
    if (!palette) return []
    const out = []
    for (const v of VIEWS) {
      if (v === 'execution' && !execVisible) continue
      out.push({ id: `v:${v}`, group: 'Views', label: VIEW_INFO[v].label, hint: VIEW_INFO[v].keys, run: () => onView(v) })
    }
    out.push(
      { id: 'a:side', group: 'Actions', label: sideHidden ? 'Show side bar' : 'Hide side bar', hint: '⌘B', run: () => setSideHidden((h) => !h) },
      { id: 'a:theme', group: 'Actions', label: `Theme: switch to ${THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length]}`, run: () => setMode(THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length]) },
      { id: 'a:classes', group: 'Actions', label: 'Refresh classes from code', run: () => (setView('classes'), refreshClasses()) },
      { id: 'a:exec', group: 'Actions', label: execVisible ? 'Hide execution plan' : 'Show execution plan', run: toggleExecution },
      { id: 'a:panels', group: 'Actions', label: 'Reset panel sizes', run: () => (setSideW(SIDE.initial), setInspW(INSPECTOR.initial)) },
      { id: 'a:keys', group: 'Actions', label: 'Keyboard shortcuts', hint: '?', run: () => setHelp(true) },
    )
    for (const f of plan.project?.folders || []) {
      const tab = plan.tabs[f]
      out.push({ id: `f:${f}`, group: 'Folders', label: f, hint: `${tab?.flows?.length || 0} flows`, run: () => navigate({ view: 'flows', folder: f }) })
      for (const fl of tab?.flows || []) out.push({ id: `fl:${f}:${fl.id}`, group: 'Flows', label: fl.title, hint: f, run: () => navigate({ view: 'flows', folder: f, flow: fl.id, ref: fl.id }) })
    }
    for (const c of classes.doc?.classes || []) out.push({ id: `c:${c.id}`, group: 'Classes', label: c.name, hint: c.file, run: () => navigate({ view: 'classes', ref: c.id }) })
    if (execVisible) for (const t of execDoc.tasks || []) out.push({ id: `t:${t.id}`, group: 'Tasks', label: t.title, hint: t.status, run: () => navigate({ view: 'execution', ref: t.id }) })
    return out
  }, [palette, execVisible, sideHidden, mode, plan.project, plan.tabs, classes.doc, execDoc, onView, setSideHidden, setMode, setView, refreshClasses, toggleExecution, navigate, setSideW, setInspW])

  const items = [
    { view: 'flows' },
    { view: 'classes', badge: findings?.errors ? { n: findings.errors, tone: 'error', desc: `${findings.errors} dependency-rule errors` } : null },
    {
      view: 'messages',
      badge: replied ? { n: replied, tone: 'replied', desc: `Claude replied in ${replied} thread${replied > 1 ? 's' : ''}` } : waiting ? { n: waiting, tone: 'waiting', desc: `${waiting} waiting for Claude` } : null,
    },
    ...(execVisible ? [{ view: 'execution' }] : []),
  ]

  if (plan.loadError) {
    return (
      <div className="empty-state">
        <div className="empty-title">Could not open the plan</div>
        <p>{plan.loadError}</p>
        <p className="empty-hint">Run /codeflow in your agent session (or npm run dev) to start the canvas.</p>
      </div>
    )
  }

  return (
    <div className="workbench">
      {plan.connection === 'ended' && (
        <div className="ended" role="status">
          The agent session that owned this canvas has ended. Changes are no longer saved. Run <code>/codeflow</code> again to reopen it.
        </div>
      )}
      <ActivityBar
        items={items}
        view={view}
        sideHidden={sideHidden}
        onView={onView}
        settings={
          <SettingsMenu
            mode={mode}
            setMode={setMode}
            executionVisible={execVisible}
            onToggleExecution={toggleExecution}
          />
        }
      />
      <div className={`wb-main view-${view} ${sideHidden ? 'side-hidden' : ''}`} style={{ '--side-w': `${sideW}px`, '--insp-w': `${inspW}px` }}>
        {!sideHidden && <Resizer edge="left" width={sideW} setWidth={setSideW} {...SIDE} offset={ACTIVITY_W} label="Side bar" />}
        <Resizer edge="right" width={inspW} setWidth={setInspW} {...INSPECTOR} label="Inspector" />
        {!fontsReady || !plan.project ? null : view === 'flows' || view === 'messages' ? (
          <FlowsView plan={plan} theme={resolved} side={view === 'messages' ? 'messages' : 'explorer'} request={requests.flows} findings={findings} onNavigate={navigate} onView={setView} />
        ) : view === 'classes' ? (
          <ClassesView doc={classes.doc} setDoc={classes.setDoc} plan={plan} theme={resolved} request={requests.classes} onNavigate={navigate} />
        ) : (
          <ExecutionView doc={execDoc} save={execution.save} plan={plan} request={requests.execution} onNavigate={navigate} />
        )}
      </div>
      <StatusBar
        project={plan.project}
        connection={plan.connection}
        saveState={plan.saveState}
        findings={findings}
        waiting={waiting}
        onFindings={() => setView('classes')}
        onMessages={() => setView('messages')}
        onPalette={() => setPalette(true)}
      />
      {palette && <CommandPalette items={paletteItems} onClose={() => setPalette(false)} />}
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
      <TooltipLayer />
    </div>
  )
}

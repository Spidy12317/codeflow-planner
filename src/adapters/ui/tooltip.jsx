import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// One tooltip layer for the whole page. Any element can ask for a tooltip with tip():
//   <button {...tip('Classes', { keys: '⌘2', desc: 'UML class diagram', side: 'right' })}>
// Shows after a short hover; once one is visible, moving to the next element shows the next
// one at once (like VS Code). desc may hold several lines ("\n").

export const tip = (label, { keys, desc, side } = {}) => ({
  'data-tip': label,
  ...(keys && { 'data-tip-keys': keys }),
  ...(desc && { 'data-tip-desc': desc }),
  ...(side && { 'data-tip-side': side }),
})

const DELAY = 450
const WARM_MS = 600
const GAP = 8

function place(rect, box, side) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x
  let y
  if (side === 'right') [x, y] = [rect.right + GAP, rect.top + rect.height / 2 - box.height / 2]
  else if (side === 'left') [x, y] = [rect.left - GAP - box.width, rect.top + rect.height / 2 - box.height / 2]
  else if (side === 'top') [x, y] = [rect.left + rect.width / 2 - box.width / 2, rect.top - GAP - box.height]
  else [x, y] = [rect.left + rect.width / 2 - box.width / 2, rect.bottom + GAP]
  // keep it on screen; flip below → above when there's no room
  if (side !== 'right' && side !== 'left' && y + box.height > vh - 4) y = rect.top - GAP - box.height
  return { x: Math.max(4, Math.min(x, vw - box.width - 4)), y: Math.max(4, Math.min(y, vh - box.height - 4)) }
}

export function TooltipLayer() {
  const [state, setState] = useState(null) // { el, label, keys, desc, side }
  const [pos, setPos] = useState(null)
  const box = useRef(null)
  const timer = useRef(null)
  const lastHide = useRef(0)
  const current = useRef(null) // element whose tooltip is shown or pending

  // Listeners live for the whole page: re-adding them on every show would cancel the
  // pending timer when moving straight from one tooltip to the next.
  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current)
      if (current.current) lastHide.current = Date.now()
      current.current = null
      setState(null)
    }
    const over = (e) => {
      const el = e.target.closest?.('[data-tip]')
      if (!el || current.current === el) return
      clearTimeout(timer.current)
      current.current = el
      const show = () => setState({ el, label: el.dataset.tip, keys: el.dataset.tipKeys, desc: el.dataset.tipDesc, side: el.dataset.tipSide })
      const warm = Date.now() - lastHide.current < WARM_MS
      timer.current = setTimeout(show, warm ? 0 : DELAY)
    }
    const out = (e) => {
      const el = e.target.closest?.('[data-tip]')
      if (el && el === current.current && !el.contains(e.relatedTarget)) hide()
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    window.addEventListener('pointerdown', hide, true)
    window.addEventListener('keydown', hide, true)
    window.addEventListener('wheel', hide, { passive: true })
    return () => {
      clearTimeout(timer.current)
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      window.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('keydown', hide, true)
      window.removeEventListener('wheel', hide)
    }
  }, [])

  // Measure, then position next to the element.
  useEffect(() => {
    if (!state || !box.current) return setPos(null)
    if (!state.el.isConnected) return setState(null)
    setPos(place(state.el.getBoundingClientRect(), box.current.getBoundingClientRect(), state.side))
  }, [state])

  if (!state) return null
  // Rendered into <body> so no canvas layer or stacking context can cover it.
  return createPortal(
    <div
      ref={box}
      className={`tooltip ${pos ? 'shown' : ''}`}
      role="tooltip"
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}
    >
      <div className="tt-head">
        <span className="tt-label">{state.label}</span>
        {state.keys && <kbd className="tt-keys">{state.keys}</kbd>}
      </div>
      {state.desc && state.desc.split('\n').map((line, i) => <div key={i} className="tt-desc">{line}</div>)}
    </div>,
    document.body,
  )
}

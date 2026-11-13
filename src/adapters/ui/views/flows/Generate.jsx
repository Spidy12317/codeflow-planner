import { useEffect, useState } from 'react'

// Pick entry points found in a folder's code and generate their flows.
// The extractor only parses the source; nothing in the target repo runs.

const KIND_LABEL = { route: 'route', method: 'method', function: 'function' }

export function GenerateDialog({ folder, existingIds, onGenerate, onClose }) {
  const [scan, setScan] = useState(null)
  const [error, setError] = useState(null)
  const [picked, setPicked] = useState(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/scan?folder=${encodeURIComponent(folder)}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || r.statusText)
        setScan(data)
        setPicked(new Set(data.entries.filter((e) => !existingIds.has(e.id)).map((e) => e.qualname)))
      })
      .catch((e) => setError(e.message))
  }, [folder]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (q) =>
    setPicked((s) => {
      const n = new Set(s)
      n.has(q) ? n.delete(q) : n.add(q)
      return n
    })

  const replacing = scan?.entries.filter((e) => picked.has(e.qualname) && existingIds.has(e.id)).length || 0

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, entries: [...picked] }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || r.statusText)
      onGenerate(data.flows)
    } catch (e) {
      setError(`Generation failed: ${e.message}`)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Generate flows from code">
        <div className="mp-head">
          <span>
            Generate from code <span className="modal-folder">{folder}</span>
          </span>
          <button className="ins-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {!scan && !error && <p className="mp-empty">Reading the code…</p>}
          {scan && scan.entries.length === 0 && (
            <p className="mp-empty">No entry points here: no route handlers, and every public function is called from elsewhere in this folder.</p>
          )}
          {scan?.entries.map((e) => (
            <label key={e.qualname} className={`gen-row ${picked.has(e.qualname) ? 'on' : ''}`} htmlFor={`gen-${e.id}`}>
              <input id={`gen-${e.id}`} type="checkbox" checked={picked.has(e.qualname)} onChange={() => toggle(e.qualname)} />
              <span className="gen-main">
                <span className="gen-title">{e.title}</span>
                <span className="gen-meta">
                  <span className={`gen-kind k-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                  <span className="gen-file">{e.file}:{e.line}</span>
                  {existingIds.has(e.id) && <span className="gen-exists">replaces current flow</span>}
                </span>
                {e.doc && <span className="gen-doc">{e.doc}</span>}
              </span>
            </label>
          ))}
          {scan?.warnings?.length > 0 && (
            <details className="gen-warn">
              <summary>{scan.warnings.length} file{scan.warnings.length > 1 ? 's' : ''} couldn't be read</summary>
              {scan.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </details>
          )}
          {error && <div className="composer-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <span className="disc-hint">
            {replacing > 0 ? `Replacing ${replacing} flow${replacing > 1 ? 's' : ''} drops edits and notes on ${replacing > 1 ? 'them' : 'it'}. Undo brings them back.` : 'Generated flows are a starting point. Edit them like any other flow.'}
          </span>
          <div className="modal-actions">
            <button className="ins-btn" onClick={onClose}>Cancel</button>
            <button className="ins-btn tone-primary" disabled={!picked.size || busy} onClick={run}>
              {busy ? 'Generating…' : `Generate ${picked.size || ''} flow${picked.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

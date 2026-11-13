import { useCallback, useState } from 'react'

// Paths as a directory tree, like the VS Code explorer. Every given path is a leaf (a plan
// folder, a file); "services/llm_service" sits under a "services" directory. A directory
// that only wraps one other directory and is not a leaf itself is compacted onto one row
// ("app/domain"). sort: true = folders before files, each A–Z (VS Code); 'alpha' = A–Z only;
// false = input order.
//   → [{ label, path, leaf, kids: [...] }]
export function pathTree(paths, { sort = false } = {}) {
  const leaves = new Set(paths)
  const root = { label: '', path: '', kids: new Map() }
  for (const p of paths) {
    let n = root
    for (const part of p.split('/')) {
      const path = n.path ? `${n.path}/${part}` : part
      if (!n.kids.has(part)) n.kids.set(part, { label: part, path, kids: new Map() })
      n = n.kids.get(part)
    }
  }
  const byName = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true })
  const order = (kids) =>
    sort === 'alpha' ? kids.sort(byName) : sort ? kids.sort((a, b) => (a.leaf === b.leaf ? byName(a, b) : a.leaf ? 1 : -1)) : kids
  const finish = (n) => {
    while (!leaves.has(n.path) && n.kids.size === 1) {
      const [only] = n.kids.values()
      n = { ...only, label: `${n.label}/${only.label}` }
    }
    return { label: n.label, path: n.path, leaf: leaves.has(n.path), kids: order([...n.kids.values()].map(finish)) }
  }
  return order([...root.kids.values()].map(finish))
}

// "a/b/c" → ["a", "a/b", "a/b/c"]
export const ancestors = (path) => path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))

// Expanded rows by key: [isOpen, toggle, reveal(keys)].
export function useExpanded(initial = []) {
  const [open, setOpen] = useState(() => new Set(initial))
  const toggle = useCallback(
    (key) =>
      setOpen((s) => {
        const n = new Set(s)
        n.has(key) ? n.delete(key) : n.add(key)
        return n
      }),
    [],
  )
  const reveal = useCallback((keys) => setOpen((s) => (keys.every((k) => s.has(k)) ? s : new Set([...s, ...keys]))), [])
  return [(key) => open.has(key), toggle, reveal]
}

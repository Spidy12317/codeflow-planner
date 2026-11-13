import fs from 'node:fs'
import path from 'node:path'

// The repo being planned, on disk: find its Python packages, create scaffold folders.

const SKIP = new Set(['.git', '.codeflow', 'node_modules', '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', 'dist', 'build', 'site-packages', 'migrations'])
const TESTS = /^tests?$/

export const fsWorkspace = {
  // Folders (relative to root) that directly hold .py files, skipping tests and tooling.
  sourceFolders(root, limit = 60) {
    const found = []
    const walk = (dir, depth) => {
      if (depth > 6 || found.length >= limit) return
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      const rel = path.relative(root, dir).split(path.sep).join('/')
      if (rel && entries.some((e) => e.isFile() && e.name.endsWith('.py') && e.name !== '__init__.py' && e.name !== 'setup.py' && e.name !== 'conftest.py')) found.push(rel)
      for (const e of entries) {
        if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.') && !TESTS.test(e.name)) walk(path.join(dir, e.name), depth + 1)
      }
    }
    walk(root, 0)
    return found.sort()
  },

  // Is there any code at all (any language) outside tooling folders?
  hasCode(root) {
    const CODE = /\.(py|js|jsx|ts|tsx|go|rs|java|kt|rb|php|cs|cpp|c|swift)$/
    const walk = (dir, depth) => {
      if (depth > 5) return false
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return false
      }
      return entries.some((e) => (e.isFile() ? CODE.test(e.name) : e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.') && walk(path.join(dir, e.name), depth + 1)))
    }
    return walk(root, 0)
  },

  // Create each folder as a Python package (an __init__.py at every level). Never overwrites.
  createPackages(root, folders) {
    const created = []
    for (const folder of folders) {
      const parts = folder.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const dir = path.join(root, ...parts.slice(0, i))
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir)
          created.push(parts.slice(0, i).join('/') + '/')
        }
        const init = path.join(dir, '__init__.py')
        if (!fs.existsSync(init)) fs.writeFileSync(init, '')
      }
    }
    return created
  },

  fileExists: (root, rel) => fs.existsSync(path.join(root, rel)),

  listFiles(root, rel) {
    try {
      return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
    } catch {
      return []
    }
  },

  readFile(root, rel) {
    try {
      return fs.readFileSync(path.join(root, rel), 'utf8')
    } catch {
      return null
    }
  },
}

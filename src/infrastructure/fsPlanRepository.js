import fs from 'node:fs'
import path from 'node:path'
import { normalizeTab } from '../domain/plan/model.js'

// File-backed plan repository shared by the HTTP API and the MCP server.
//   <planDir>/project.json        { name, root?, folders, layers?, scaffold? }
//   <planDir>/tabs/<folder>.json  one tab per repo folder ("/" → "__")
//   <planDir>/threads.json        message threads between you and Claude
//   <planDir>/<name>.json         other documents (classes, execution)
// Writes return { file, text } so a caller can recognise its own writes in a watcher.

export const fileFor = (folder) => folder.replaceAll('/', '__') + '.json'

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback)

function writeJson(file, value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  writeAtomic(file, text)
  return { file, text }
}

export function createFsPlanRepository(planDir) {
  const tabsDir = path.join(planDir, 'tabs')
  const projectFile = path.join(planDir, 'project.json')
  const threadsFile = path.join(planDir, 'threads.json')
  const docFile = (name) => path.join(planDir, `${name}.json`)

  const repo = {
    planDir,

    exists: () => fs.existsSync(projectFile),

    readProject() {
      const project = readJson(projectFile, null)
      if (!project) throw new Error(`No plan at ${planDir} (project.json missing)`)
      // root is optional: a plan inside <repo>/.codeflow plans its parent directory.
      project.root = path.resolve(planDir, project.root || '..')
      return project
    },

    // root is written only when the plan lives outside the repo it plans.
    writeProject(project) {
      fs.mkdirSync(tabsDir, { recursive: true })
      const { root, ...rest } = project
      const external = root && path.resolve(planDir, '..') !== path.resolve(planDir, root)
      return writeJson(projectFile, external ? { name: rest.name, root, ...rest } : rest)
    },

    listTabs() {
      const tabs = {}
      if (!fs.existsSync(tabsDir)) return tabs
      for (const f of fs.readdirSync(tabsDir).filter((f) => f.endsWith('.json'))) {
        const tab = readJson(path.join(tabsDir, f))
        tabs[tab.folder] = tab
      }
      return tabs
    },

    readTab: (folder) => readJson(path.join(tabsDir, fileFor(folder)), null),

    writeTab(tab) {
      normalizeTab(tab)
      fs.mkdirSync(tabsDir, { recursive: true })
      return writeJson(path.join(tabsDir, fileFor(tab.folder)), tab)
    },

    readThreads: () => readJson(threadsFile, []),
    writeThreads: (threads) => writeJson(threadsFile, threads),

    readDoc: (name, fallback = null) => readJson(docFile(name), fallback),
    writeDoc: (name, value) => writeJson(docFile(name), value),

    // onChange(kind, file, text): kind is 'tab' | 'threads' | 'project' | <doc name>.
    // Debounced per file; returns a function that stops watching.
    watch(onChange) {
      const timers = new Map()
      const fire = (kind, file) => {
        clearTimeout(timers.get(file))
        timers.set(
          file,
          setTimeout(() => {
            if (fs.existsSync(file)) onChange(kind, file, fs.readFileSync(file, 'utf8'))
          }, 120),
        )
      }
      fs.mkdirSync(tabsDir, { recursive: true })
      const watchers = [
        fs.watch(tabsDir, (_e, name) => {
          if (name?.endsWith('.json')) fire('tab', path.join(tabsDir, name))
        }),
        fs.watch(planDir, (_e, name) => {
          if (name?.endsWith('.json') && !name.startsWith('.')) fire(name.slice(0, -5), path.join(planDir, name))
        }),
      ]
      return () => {
        watchers.forEach((w) => w.close())
        timers.forEach(clearTimeout)
      }
    },
  }
  return repo
}

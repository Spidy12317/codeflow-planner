import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The extractor script sits next to this module, or next to the bundle in build/.
const here = path.dirname(fileURLToPath(import.meta.url))
const EXTRACTOR = [path.join(here, 'extract_py.py'), path.join(here, '../src/infrastructure/extract_py.py')].find((p) => fs.existsSync(p))
const PYTHON = process.env.CODEFLOW_PYTHON || 'python3'

// Run the static extractor (-I: isolated, ignores env/user site; the target code is only parsed).
function run(args) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, ['-I', EXTRACTOR, ...args], { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim().split('\n').pop() || err.message))
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error('Extractor returned invalid output'))
      }
    })
  })
}

const base = (cmd, project) => [cmd, '--root', project.root, '--folders', project.folders.join(',')]

// CodeExtractor port, backed by extract_py.py.
export const pythonExtractor = {
  // → { entries: [{ id, qualname, ... }], warnings }
  scan: (project, folder) => run([...base('scan', project), '--folder', folder]),

  // → { flows, warnings }
  generate: (project, folder, entries) => run([...base('generate', project), '--folder', folder, ...entries.flatMap((e) => ['--entry', e])]),

  // → { modules, classes, warnings } for the UML view
  classes: (project) => run(base('classes', project)),
}

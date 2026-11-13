// Ports the use cases depend on. Infrastructure provides the implementations; the
// composition root (src/main) wires them together. JSDoc only: nothing to import at runtime.

/**
 * @typedef {object} PlanRepository   (infrastructure/fsPlanRepository.js)
 * @property {string} planDir
 * @property {() => boolean} exists
 * @property {() => object} readProject             project.json with an absolute root
 * @property {(project: object) => Write} writeProject
 * @property {() => Record<string, object>} listTabs   folder → tab
 * @property {(folder: string) => object|null} readTab
 * @property {(tab: object) => Write} writeTab
 * @property {() => object[]} readThreads
 * @property {(threads: object[]) => Write} writeThreads
 * @property {(name: string, fallback?: any) => any} readDoc     other plan documents (classes, execution)
 * @property {(name: string, value: any) => Write} writeDoc
 * @property {(onChange: (kind: string, file: string, text: string) => void) => () => void} watch
 */

/** @typedef {{ file: string, text: string }} Write */

/**
 * @typedef {object} CodeExtractor   (infrastructure/pythonExtractor.js)
 * @property {(project: object, folder: string) => Promise<{entries: object[], warnings: string[]}>} scan
 * @property {(project: object, folder: string, entries: string[]) => Promise<{flows: object[], warnings: string[]}>} generate
 * @property {(project: object) => Promise<object>} classes
 */

/**
 * Use cases receive a context:
 * @typedef {object} Ctx
 * @property {PlanRepository} repo
 * @property {CodeExtractor} extractor
 */

export {}

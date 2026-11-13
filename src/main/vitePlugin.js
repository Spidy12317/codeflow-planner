import { createApi } from '../adapters/http/routes.js'
import { createFsPlanRepository } from '../infrastructure/fsPlanRepository.js'
import { pythonExtractor } from '../infrastructure/pythonExtractor.js'

// Dev only: mounts the plan API into `npm run dev` so the canvas hot-reloads.
export function planApi(planDir) {
  return {
    name: 'codeflow-plan-api',
    configureServer(server) {
      const api = createApi({ repo: createFsPlanRepository(planDir), extractor: pythonExtractor })
      server.middlewares.use('/api', async (req, res, next) => {
        if ((await api.handle(req, res, req.url)) === false) next()
      })
      server.httpServer?.on('close', api.close)
    },
  }
}

import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { planApi } from './src/main/vitePlugin.js'

// Which plan to open: the demo fixture by default. Override with
// CODEFLOW_PLAN_DIR=/path/to/repo/.codeflow npm run dev
const PLAN_DIR = path.resolve(process.env.CODEFLOW_PLAN_DIR || 'test/fixtures/solid_py/.codeflow')

export default defineConfig({
  plugins: [react(), planApi(PLAN_DIR)],
  server: { port: 5199, watch: { ignored: ['**/.codeflow/**'] } },
})

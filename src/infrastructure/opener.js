import { spawn } from 'node:child_process'

// Open a URL in the default browser, detached so it never blocks or outlives a failure.
export function openUrl(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
    return true
  } catch {
    return false
  }
}

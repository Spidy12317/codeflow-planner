// Deterministic text wrapping for pseudo-code nodes (monospace), so node heights are
// known before render and connectors line up without a measuring pass.
export const PS_FONT_PX = 11
export const PS_LINE = 15
const FONT = `${PS_FONT_PX}px 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`

let charW = 6.62

export function initMeasure() {
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.font = FONT
  charW = ctx.measureText('MMMMMMMMMM').width / 10
}

export function loadFonts() {
  const fonts = [
    `${PS_FONT_PX}px 'JetBrains Mono'`,
    `500 ${PS_FONT_PX}px 'JetBrains Mono'`,
    `400 13px 'Inter'`,
    `700 13px 'Inter'`,
  ]
  const timeout = new Promise((r) => setTimeout(r, 1500))
  return Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))).catch(() => {}), timeout]).then(initMeasure)
}

export function wrap(text, widthPx) {
  const max = Math.max(8, Math.floor(widthPx / charW))
  const out = []
  let line = ''
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    let w = word
    while (w.length > max) {
      if (line) {
        out.push(line)
        line = ''
      }
      out.push(w.slice(0, max))
      w = w.slice(max)
    }
    if (!line) line = w
    else if (line.length + 1 + w.length <= max) line += ' ' + w
    else {
      out.push(line)
      line = w
    }
  }
  if (line) out.push(line)
  return out.length ? out : ['']
}

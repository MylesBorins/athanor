// Minimal ANSI styling with auto-detection. No dependency.
// Respects the NO_COLOR convention (https://no-color.org) and
// disables colors when stdout is not a TTY.

const enabled: boolean =
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb" &&
  !!process.stdout.isTTY

function wrap(open: number, close: number) {
  return (s: string | number): string => {
    const str = String(s)
    return enabled ? `\x1b[${open}m${str}\x1b[${close}m` : str
  }
}

export const style = {
  bold:    wrap(1, 22),
  dim:     wrap(2, 22),
  italic:  wrap(3, 23),

  red:     wrap(31, 39),
  green:   wrap(32, 39),
  yellow:  wrap(33, 39),
  blue:    wrap(34, 39),
  magenta: wrap(35, 39),
  cyan:    wrap(36, 39),
  gray:    wrap(90, 39)
}

// Glyphs used across the CLI. Stick to characters that render in common
// terminal fonts (SF Mono, Menlo, JetBrains Mono, etc.).
export const sym = {
  check:   "✓",
  cross:   "✗",
  arrow:   "→",
  bullet:  "•",
  running: "●",
  starting:"◐",
  idle:    "○",
  error:   "✕",
  warn:    "⚠",
  down:    "↓"
}

export function statusGlyph(status?: string): string {
  switch (status) {
    case "running":  return style.green(sym.running)
    case "starting": return style.yellow(sym.starting)
    case "error":    return style.red(sym.error)
    case "exited":   return style.gray(sym.idle)
    default:         return style.gray(sym.idle)
  }
}

// Strip ANSI codes for width calculations. This matters in tables
// where we pad by character count.
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

export function padEndVisual(s: string, width: number): string {
  const visible = stripAnsi(s).length
  if (visible >= width) return s
  return s + " ".repeat(width - visible)
}

export function isColorEnabled(): boolean {
  return enabled
}

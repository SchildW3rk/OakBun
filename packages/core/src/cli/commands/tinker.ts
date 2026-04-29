import { resolve } from 'node:path'
import type { OakBunConfig } from '../config/types'
import type { TableDef, SchemaMap } from '../../schema/table'
import { discoverTables } from '../discovery/tables'
import { discoverServices } from '../discovery/services'
import { loadAdapter } from './migrate/adapter'

// ── isComplete — bracket/string depth check ───────────────────────────────────

export function isComplete(code: string): boolean {
  let depth  = 0
  let inStr  = false
  let strCh  = ''

  for (const ch of code) {
    if (inStr) {
      if (ch === strCh) inStr = false
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = true
      strCh = ch
    } else if (ch === '(' || ch === '{' || ch === '[') {
      depth++
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
    }
  }

  return depth === 0 && !inStr
}

// ── formatValue — human-readable cell value ───────────────────────────────────

export function formatValue(val: unknown): string {
  if (val instanceof Date) {
    return val.toISOString().replace('T', ' ').slice(0, 19)
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    return val.replace('T', ' ').slice(0, 19)
  }
  return String(val ?? '')
}

// ── formatTable — ASCII table for arrays of objects ───────────────────────────

export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '\x1b[2m[]\x1b[0m'

  const keys   = Object.keys(rows[0])
  const widths = keys.map(k =>
    Math.max(k.length, ...rows.map(r => formatValue(r[k]).length)),
  )

  const top    = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐'
  const middle = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤'
  const bottom = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘'

  const header  = '│ ' + keys.map((k, i) => `\x1b[2m${k.padEnd(widths[i])}\x1b[0m`).join(' │ ') + ' │'
  const rowStrs = rows.map(r =>
    '│ ' + keys.map((k, i) => formatValue(r[k]).padEnd(widths[i])).join(' │ ') + ' │',
  )

  return [
    top,
    header,
    middle,
    ...rowStrs,
    bottom,
    `\x1b[2m(${rows.length} row${rows.length === 1 ? '' : 's'})\x1b[0m`,
  ].join('\n')
}

// ── formatResult — pretty-print any value ─────────────────────────────────────

export function formatResult(value: unknown): string {
  if (value === null)      return '\x1b[2mnull\x1b[0m'
  if (value === undefined) return '\x1b[2mundefined\x1b[0m'

  if (Array.isArray(value)) {
    if (value.length === 0) return '\x1b[2m[]\x1b[0m'
    if (typeof value[0] === 'object' && value[0] !== null) {
      return formatTable(value as Record<string, unknown>[])
    }
    return JSON.stringify(value, null, 2)
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }

  return String(value)
}

// ── Banner + Help ──────────────────────────────────────────────────────────────

function printBanner(
  tables:   Record<string, TableDef<unknown, SchemaMap>>,
  services: Record<string, unknown>,
): void {
  const tableNames   = Object.keys(tables)
  const serviceNames = Object.keys(services)

  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  \x1b[1mOakBun Shell\x1b[0m')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  \x1b[1mContext:\x1b[0m')
  console.log(`  \x1b[36mdb\x1b[0m          → BoundOakBunDB`)
  console.log(`  \x1b[36mtables\x1b[0m      → { ${tableNames.join(', ') || 'none'} }`)
  console.log(`  \x1b[36mservices\x1b[0m    → { ${serviceNames.join(', ') || 'none'} }`)
  console.log(`  \x1b[36mmigrator\x1b[0m    → Migrator`)
  console.log(`  \x1b[36mbus\x1b[0m         → EventBus`)
  console.log('')
  console.log('  \x1b[1mExamples:\x1b[0m')
  if (tableNames[0]) {
    console.log(`  \x1b[2mawait db.from(tables.${tableNames[0]}).select()\x1b[0m`)
    console.log(`  \x1b[2mawait db.from(tables.${tableNames[0]}).where({ id: 1 }).first()\x1b[0m`)
  }
  if (serviceNames[0]) {
    console.log(`  \x1b[2mawait services.${serviceNames[0]}.findAll()\x1b[0m`)
  }
  console.log(`  \x1b[2mawait migrator.status()\x1b[0m`)
  console.log(`  \x1b[2mbus.emit('event.name', { id: 1 })\x1b[0m`)
  console.log('')
  console.log('  \x1b[2m.tables  .help  .exit\x1b[0m')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
}

function printHelp(): void {
  console.log('')
  console.log('  \x1b[1mCommands:\x1b[0m')
  console.log('  .tables   list discovered tables')
  console.log('  .help     show this help')
  console.log('  .exit     quit the REPL')
  console.log('')
  console.log('  \x1b[1mContext variables:\x1b[0m')
  console.log('  db        BoundOakBunDB — db.from(tables.users).select()')
  console.log('  tables    discovered TableDefs by name')
  console.log('  adapter   raw OakBunAdapter — adapter.query("SELECT ...")')
  console.log('  services  instantiated services by key')
  console.log('  bus       EventBus — bus.emit("user.created", payload)')
  console.log('  migrator  Migrator — migrator.status() / migrator.run()')
  console.log('')
}

// ── Eval ──────────────────────────────────────────────────────────────────────

interface EvalContext {
  db:       unknown
  tables:   unknown
  adapter:  unknown
  services: unknown
  bus:      unknown
  migrator: unknown
}

async function evalLine(code: string, context: EvalContext): Promise<unknown> {
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  const js         = transpiler.transformSync(code)

  const fn = new Function(
    'db', 'tables', 'adapter', 'services', 'bus', 'migrator',
    `return (async () => { return ${js} })()`,
  )
  return fn(
    context.db, context.tables, context.adapter,
    context.services, context.bus, context.migrator,
  ) as Promise<unknown>
}

// ── Raw mode input — character-by-character with history ─────────────────────

const PROMPT      = '\x1b[36m>>\x1b[0m '
const PROMPT_CONT = '\x1b[2m..\x1b[0m '

interface ReplState {
  buffer:       string   // multi-line accumulator
  currentLine:  string   // chars typed so far on this line
  cursorPos:    number   // insertion point within currentLine
  history:      string[] // submitted lines, newest first
  historyIndex: number   // -1 = not browsing
}

// Prompt string length without ANSI codes — used for column arithmetic.
// '>>' = 2 chars + reset sequence + ' ' = 3 visible chars → 4 columns (1-indexed)
const PROMPT_VISIBLE_LEN      = 3  // '>> '
const PROMPT_CONT_VISIBLE_LEN = 3  // '.. '

function promptVisibleLen(state: ReplState): number {
  return state.buffer ? PROMPT_CONT_VISIBLE_LEN : PROMPT_VISIBLE_LEN
}

function clearLine(state: ReplState): void {
  const promptStr = state.buffer ? PROMPT_CONT : PROMPT
  process.stdout.write(`\r\x1b[2K${promptStr}`)
}

function writePrompt(state: ReplState): void {
  process.stdout.write(state.buffer ? PROMPT_CONT : PROMPT)
}

// Redraw the current line and reposition the cursor.
function redrawLine(state: ReplState): void {
  clearLine(state)
  process.stdout.write(state.currentLine)
  // Move cursor to cursorPos (1-indexed column = promptLen + cursorPos + 1)
  const col = promptVisibleLen(state) + state.cursorPos + 1
  process.stdout.write(`\x1b[${col}G`)
}

// ── Main REPL entry ───────────────────────────────────────────────────────────

export async function tinker(_args: string[], config: OakBunConfig): Promise<void> {
  const adapter      = await loadAdapter(config)
  const tableList    = await discoverTables(config)
  const serviceDefs  = await discoverServices(config)

  const tables: Record<string, TableDef<unknown, SchemaMap>> = {}
  for (const t of tableList) tables[t.name] = t

  const { OakBunDB }            = await import('../../db/index')
  const { HookExecutor }      = await import('../../hooks/executor')
  const { RequestEventQueue, EventBus } = await import('../../events/index')
  const { createSystemCtx }   = await import('../../app/system-ctx')
  const { instantiateServices } = await import('../../service/index')
  const { createMigrator }    = await import('../../db/migrations/index')

  const hooks  = new HookExecutor()
  hooks.setAdapter(adapter)
  const oakBunDB   = new OakBunDB(adapter, hooks)
  const db       = oakBunDB.withCtx(createSystemCtx(), new RequestEventQueue())
  const services = instantiateServices(serviceDefs, db)
  const bus      = new EventBus()
  const migrator = createMigrator(adapter, {
    migrationsDir: resolve(process.cwd(), config.migrations ?? './migrations'),
  })

  const evalCtx: EvalContext = { db, tables, adapter, services, bus, migrator }

  printBanner(tables, services)

  const state: ReplState = {
    buffer:       '',
    currentLine:  '',
    cursorPos:    0,
    history:      [],
    historyIndex: -1,
  }

  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')

  writePrompt(state)

  for await (const chunk of process.stdin) {
    const ch = String(chunk)

    // ── Control characters ────────────────────────────────────────────────
    if (ch === '\x03' || ch === '\x04') {
      // Ctrl+C / Ctrl+D
      console.log('\nBye! 👋')
      process.exit(0)
    }

    // ── Arrow Up — older history ──────────────────────────────────────────
    if (ch === '\x1b[A') {
      if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++
        state.currentLine = state.history[state.historyIndex]
        state.cursorPos   = state.currentLine.length
        redrawLine(state)
      }
      continue
    }

    // ── Arrow Down — newer history ────────────────────────────────────────
    if (ch === '\x1b[B') {
      if (state.historyIndex > 0) {
        state.historyIndex--
        state.currentLine = state.history[state.historyIndex]
      } else {
        state.historyIndex = -1
        state.currentLine  = ''
      }
      state.cursorPos = state.currentLine.length
      redrawLine(state)
      continue
    }

    // ── Arrow Right ───────────────────────────────────────────────────────
    if (ch === '\x1b[C') {
      if (state.cursorPos < state.currentLine.length) {
        state.cursorPos++
        process.stdout.write('\x1b[C')
      }
      continue
    }

    // ── Arrow Left ────────────────────────────────────────────────────────
    if (ch === '\x1b[D') {
      if (state.cursorPos > 0) {
        state.cursorPos--
        process.stdout.write('\x1b[D')
      }
      continue
    }

    // ── Skip other escape sequences (function keys, etc.) ─────────────────
    if (ch.startsWith('\x1b')) continue

    // ── Backspace — delete char before cursor ─────────────────────────────
    if (ch === '\x7f') {
      if (state.cursorPos > 0) {
        state.currentLine =
          state.currentLine.slice(0, state.cursorPos - 1) +
          state.currentLine.slice(state.cursorPos)
        state.cursorPos--
        redrawLine(state)
      }
      continue
    }

    // ── Enter ─────────────────────────────────────────────────────────────
    if (ch === '\r' || ch === '\n') {
      process.stdout.write('\n')
      const line    = state.currentLine
      const trimmed = line.trim()
      state.currentLine  = ''
      state.cursorPos    = 0
      state.historyIndex = -1

      // Dot commands — only at top level (no multi-line buffer)
      if (state.buffer === '' && trimmed.startsWith('.')) {
        if (trimmed === '.exit' || trimmed === '.quit') {
          console.log('Bye! 👋')
          process.exit(0)
        }
        if (trimmed === '.help') {
          printHelp()
          writePrompt(state)
          continue
        }
        if (trimmed === '.tables') {
          const names = Object.keys(tables)
          console.log(names.length === 0 ? '  No tables found.' : `  ${names.join(', ')}`)
          writePrompt(state)
          continue
        }
      }

      if (!trimmed) {
        writePrompt(state)
        continue
      }

      // Add to history (avoid duplicates at top)
      if (state.history[0] !== trimmed) state.history.unshift(trimmed)

      state.buffer += (state.buffer ? '\n' : '') + line

      if (!isComplete(state.buffer)) {
        writePrompt(state)
        continue
      }

      const code    = state.buffer
      state.buffer  = ''

      try {
        const result = await evalLine(code, evalCtx)
        if (result !== undefined) console.log(formatResult(result))
      } catch (err) {
        console.error(`\x1b[31m[Error]\x1b[0m ${err instanceof Error ? err.message : String(err)}`)
      }

      writePrompt(state)
      continue
    }

    // ── Printable character — insert at cursor position ──────────────────
    if (ch >= ' ') {
      state.currentLine =
        state.currentLine.slice(0, state.cursorPos) + ch +
        state.currentLine.slice(state.cursorPos)
      state.cursorPos++
      if (state.cursorPos === state.currentLine.length) {
        // Cursor is at end — simple append, no full redraw needed
        process.stdout.write(ch)
      } else {
        redrawLine(state)
      }
    }
  }

  console.log('\nBye!')
}

---
title: "DB Plugin / Logger Plugin / EventBus Plugin"
category: "plugins"
tags: ["db", "database", "logger", "eventbus", "plugin"]
related: ["SQL Overview", "Hooks & Events", "definePlugin"]
---

# DB Plugin / Logger Plugin / EventBus Plugin

Three foundational plugins included in the `oakbun` core package.

---

## dbPlugin

Attaches `ctx.db` (a `BoundVelnDB`) to every request.

### Signature

```ts
function dbPlugin(
  config: AdapterConfig | VelnAdapter,
  log?:   DbLogOptions,
): Plugin<BaseCtx, { db: BoundVelnDB }>
```

### Basic Example

```ts
import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'

const app = createApp()
app.plugin(dbPlugin(new SQLiteAdapter({ filename: 'app.db' })))
```

### With Query Logging

```ts
app.plugin(dbPlugin(adapter, {
  enabled:     true,
  logQueries:  true,
  slowQueryMs: 200,
  n1Threshold: 10,
  level:       'debug',
}))
```

### DbLogOptions

| Option | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Enable query logging (default: `false`) |
| `logQueries` | `boolean` | Log each query |
| `slowQueryMs` | `number` | Warn on queries exceeding this threshold |
| `n1Threshold` | `number` | Warn when request query count exceeds this |
| `level` | `LogLevel` | Log level |
| `onQuery` | `(entry: QueryLogEntry) => void` | Custom callback per query |

### AdapterConfig

```ts
type AdapterConfig =
  | { type: 'sqlite';   filename: string }
  | { type: 'postgres'; url: string }
  | { type: 'mysql';    url: string }
```

---

## loggerPlugin

Attaches `ctx.logger` to every request.

### Signature

```ts
function loggerPlugin(options?: LoggerOptions): Plugin<BaseCtx, { logger: VelnLogger }>
```

### Example

```ts
import { loggerPlugin } from 'oakbun'

app.plugin(loggerPlugin({ level: 'info' }))

// In a handler:
ctx.logger.info('User created', { id: user.id })
ctx.logger.warn('Slow query', { ms: 450 })
ctx.logger.error('Unexpected error', { err })
```

### VelnLogger Interface

```ts
interface VelnLogger {
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}
```

Output format: pretty-printed in TTY, JSON in non-TTY environments (auto-detected).

For the full-featured structured logger with masking and route tree printing, see [`@oakbun/logger`](./04-db-plugin.md).

---

## eventBusPlugin

Attaches `ctx.events` (an `InMemoryEventBus`) to every request.

### Signature

```ts
function eventBusPlugin(
  bus?: InMemoryEventBus,
): Plugin<BaseCtx, { events: InMemoryEventBus }> & { bus: InMemoryEventBus }
```

### Example

```ts
import { eventBusPlugin } from 'oakbun'

const eventsPlugin = eventBusPlugin()
app.plugin(eventsPlugin)

// Access the shared bus (e.g. to register handlers at startup)
eventsPlugin.bus.on('user.created', async (payload, ctx) => {
  await sendWelcomeEmail(payload.email)
})
```

### Events from Table Operations

Events declared via `.emits()` on a table are emitted automatically after successful insert/update/delete. They are queued on the request and flushed after the response is sent.

```ts
// Events emitted automatically when using ctx.db with a table that has .emits()
const user = await ctx.db.into(usersTable).insert({ name: 'Alice', email: 'alice@example.com' })
// → queues 'user.created' event
// → flushed after response
```

### Manual emit

```ts
await ctx.emit('user.created', { id: user.id, email: user.email })
```

## See Also

- [SQL Overview](../sql/01-overview.md)
- [Query Logging](../sql/10-query-logging.md)
- [Hooks & Events](../guides/03-hooks-and-events.md)

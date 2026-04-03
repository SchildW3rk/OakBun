---
title: "WebSocket Plugin"
category: "plugins"
tags: ["websocket", "ws", "realtime", "plugin"]
related: ["defineModule", "Plugin System"]
---

# WebSocket Plugin — @oakbun/ws

`@oakbun/ws` adds WebSocket support to OakBun using Bun's native WebSocket API.

## Installation

```bash
bun add @oakbun/ws
```

## Setup

```ts
import { createApp } from 'oakbun'
import { createWsAdapter } from '@oakbun/ws'
import '@oakbun/ws'  // side-effect: patches ModuleBuilder.prototype.ws()

const ws = createWsAdapter()
const app = createApp()

app.registerWsAdapter(ws)
```

## Registering WebSocket Routes

After importing `@oakbun/ws`, the `.ws()` method is available on `ModuleBuilder`:

```ts
import { defineModule } from 'oakbun'

const chatModule = defineModule('/chat')
  .ws('/ws', {
    open(ctx) {
      ctx.ws.send('Welcome to the chat!')
    },
    message(ctx, raw) {
      // Echo messages back
      ctx.ws.send(raw)
    },
    close(ctx) {
      console.log('Client disconnected')
    },
  })
  .build()

app.register(chatModule)
```

## Typed Messages

Provide a Zod schema to validate incoming messages:

```ts
import { z } from 'zod'

const messageSchema = z.object({
  type:    z.enum(['chat', 'ping']),
  content: z.string(),
})

defineModule('/chat')
  .ws('/ws', {
    messageSchema,
    open(ctx) {
      ctx.ws.send(JSON.stringify({ type: 'welcome' }))
    },
    message(ctx, msg) {
      // msg is validated and typed: { type: 'chat' | 'ping', content: string }
      if (msg.type === 'chat') {
        ctx.ws.send(JSON.stringify({ type: 'echo', content: msg.content }))
      }
    },
  })
```

## WsHandlers

| Handler | Signature | Description |
|---|---|---|
| `open` | `(ctx: WsCtx) => void` | Client connected |
| `message` | `(ctx: WsCtx, msg: TMsg) => void` | Message received |
| `close` | `(ctx: WsCtx) => void` | Client disconnected |
| `drain` | `(ctx: WsCtx) => void` | Socket buffer drained |

## WsCtx

The WebSocket context extends the base request context:

```ts
interface WsCtxData {
  ws: {
    send(data: string | Uint8Array): void
    close(code?: number, reason?: string): void
    data: Record<string, unknown>  // attached from http upgrade
  }
}
```

Plus all ctx fields from registered plugins (`ctx.db`, `ctx.jwtUser`, etc.)

## Rate Limiting

Pass rate limit config to `createWsAdapter`:

```ts
const ws = createWsAdapter({
  max:      60,    // max messages per window
  windowMs: 1000,  // window in ms (default: 1000ms)
})
```

Clients exceeding the limit have their connection closed automatically.

## createWsAdapter Options

| Option | Type | Default | Description |
|---|---|---|---|
| `max` | `number` | `60` | Max messages per windowMs |
| `windowMs` | `number` | `1000` | Rate limit window |

## See Also

- [defineModule](../core/02-define-module.md)
- [Plugin System](./01-plugin-system.md)

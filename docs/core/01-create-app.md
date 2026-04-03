---
title: "createApp"
category: "core"
tags: ["app", "factory", "listen", "register"]
related: ["defineModule", "definePlugin", "defineMiddleware"]
---

# createApp

Creates and returns a `Veln` application instance. The app manages plugin registration, route mounting, and the HTTP server lifecycle.

## Signature

```ts
function createApp(): Veln
```

## Basic Example

```ts
import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'

const app = createApp()

app.use(dbPlugin(new SQLiteAdapter({ filename: 'app.db' })))
app.register(usersModule)
app.listen(3000)
```

## Methods

### `app.use(plugin)`

Register a plugin or middleware. Plugins run in registration order on every request.

```ts
app.use(loggerPlugin())
app.use(eventBusPlugin())
app.use(dbPlugin(adapter))
```

### `app.register(module)`

Mount a built module onto the app.

```ts
app.register(usersModule)
app.register(postsModule)
```

### `app.listen(port, options?)`

Start the Bun HTTP server. Returns a `Server` instance.

```ts
const server = app.listen(3000)
// or with options:
const server = app.listen({ port: 3000, hostname: '0.0.0.0' })
```

### `app.get / .post / .put / .patch / .delete`

Register top-level routes directly on the app without a module.

```ts
app.get('/health', (ctx) => ctx.json({ ok: true }))

app.post('/auth/token', {
  body: z.object({ email: z.string(), password: z.string() }),
  async handler(ctx) {
    // ...
    return ctx.json({ token })
  },
})
```

### `app.on(event, handler)`

Subscribe to a typed event on the default event bus.

```ts
app.on('user.created', async (payload, ctx) => {
  console.log('new user:', payload)
})
```

### `app.close()`

Gracefully shut down the server. Calls `teardown()` on all plugins in reverse order.

```ts
process.on('SIGTERM', () => app.close())
```

### `app.getOpenApiSpec(options?)`

Returns the OpenAPI 3.0 spec object derived from all registered routes with `body`, `params`, `query`, or `response` schemas.

```ts
const spec = app.getOpenApiSpec({ title: 'My API', version: '1.0.0' })
```

## Event Hooks

Register lifecycle hooks at the app level:

```ts
app.onRequest((ctx) => { /* runs before every route handler */ })
app.onBeforeHandle((ctx) => { /* runs after routing, before handler */ })
app.onResponse((ctx, response) => { /* runs after handler */ })
app.onError((err, ctx) => new Response('Error', { status: 500 }))
```

## WebSocket Adapter

```ts
import { createWsAdapter } from '@oakbun/ws'
import '@oakbun/ws' // side-effect: patches ModuleBuilder.prototype.ws()

const ws = createWsAdapter()
app.registerWsAdapter(ws)
```

## See Also

- [defineModule](./02-define-module.md)
- [definePlugin](./04-define-plugin.md)
- [DB Plugin](../plugins/04-db-plugin.md)
- [ctx Reference](../api/01-ctx-reference.md)

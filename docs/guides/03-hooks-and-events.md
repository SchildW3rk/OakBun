---
title: "Hooks & Events"
category: "guides"
tags: ["hooks", "events", "eventbus", "table-hooks"]
related: ["defineTable", "defineModule", "DB Plugin"]
---

# Hooks & Events

OakBun provides two hook layers: **table hooks** (no ctx, run synchronously on row data) and **module hooks** (with ctx, run inside the request lifecycle).

---

## Table Hooks

Table hooks run on insert/update/delete operations. They do not have access to the request context.

```ts
export const usersTable = defineTable('users', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  email: column.text().unique(),
})
  .hook({
    beforeInsert: (data) => ({ ...data, createdAt: new Date() }),
    afterInsert:  (row) => { /* no return needed */ },
    beforeUpdate: (data) => data,
    afterUpdate:  (row) => { /* cleanup, logging */ },
    beforeDelete: (row) => { /* check dependencies */ },
    afterDelete:  (row) => { /* cleanup */ },
  })
  .build()
```

`beforeInsert` and `beforeUpdate` can return a modified version of the data.

---

## Module Hooks (with ctx)

For hooks that need context (e.g., `ctx.user`, `ctx.db`), use `.hook()` on the module builder:

```ts
defineModule('/posts')
  .hook(postsTable, {
    afterInsert: async (row, ctx) => {
      await ctx.emit('post.created', row)
    },
    afterDelete: async (row, ctx) => {
      // Clean up related data
      await ctx.db.from(commentsTable).where({ postId: row.id }).delete()
    },
  })
  .build()
```

---

## Events via .emits()

Tables can declare event names that are automatically emitted after successful database operations:

```ts
const postsTable = defineTable('posts', { /* ... */ })
  .emits({
    afterInsert: 'post.created',
    afterUpdate: 'post.updated',
    afterDelete: 'post.deleted',
  })
  .build()
```

Events are queued during the request and flushed **after** the response is sent. This ensures DB operations and the response complete before any side effects run.

---

## EventBus

Subscribe to events with `app.on()` or by wiring `defineEventHandler` to a module:

```ts
import { InMemoryEventBus } from 'oakbun'

const bus = new InMemoryEventBus({
  onError: (err, event) => console.error('Event error:', event, err),
})

bus.on('post.created', async (payload, ctx) => {
  await sendNotification(payload)
})
```

Or via `eventBusPlugin`:

```ts
const eventsPlugin = eventBusPlugin()
app.plugin(eventsPlugin)

eventsPlugin.bus.on('user.created', async (payload) => {
  console.log('New user:', payload.email)
})
```

---

## defineEventHandler

`defineEventHandler` creates a typed event handler definition that can be registered on a module:

```ts
import { defineEventHandler } from 'oakbun'
import { NotificationService } from './services/notification.service'

const userEventHandler = defineEventHandler(usersTable)
  .use(NotificationService)
  .on('user.created', async (payload, { notifications, logger }) => {
    await notifications.sendWelcomeEmail(payload.email)
    logger.info('Welcome email sent', { userId: payload.id })
  })
  .on('user.deleted', async (payload, { notifications }) => {
    await notifications.sendGoodbyeEmail(payload.email)
  })
  .build()

// Register on a module:
const usersModule = defineModule('/users')
  .events(userEventHandler)
  .build()
```

---

## Request Lifecycle Hooks

Per-request hooks that run for all routes in a module or the entire app:

```ts
defineModule('/api')
  .onRequest(async (ctx) => {
    // Runs before routing — mutate ctx here
    ctx._startTime = Date.now()
  })
  .onBeforeHandle(async (ctx) => {
    // Runs after routing + guards, before handler
  })
  .onResponse(async (ctx, response) => {
    // Runs after handler — cannot modify response body
    const duration = Date.now() - (ctx._startTime ?? 0)
    ctx.logger?.info('request', { path: new URL(ctx.req.url).pathname, ms: duration })
  })
  .build()
```

---

## Manual emit

Emit events from within a handler:

```ts
.post('/', async (ctx) => {
  const user = await ctx.db.into(usersTable).insert(ctx.body)
  await ctx.emit('user.created', user)  // queued, flushed after response
  return ctx.json(user, 201)
})
```

## See Also

- [defineTable / column](../core/09-define-table.md)
- [defineEventHandler](../api/02-types-reference.md)
- [Audit Logging](./04-audit-logging.md)
- [DB Plugin](../plugins/04-db-plugin.md)

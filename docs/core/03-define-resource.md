---
title: "defineResource"
category: "core"
tags: ["resource", "crud", "rest", "builder"]
related: ["defineModule", "defineModel", "defineService"]
---

# defineResource

Generates a complete CRUD module from a table definition. Produces five standard routes: `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`.

## Signature

```ts
function defineResource<T, S extends SchemaMap>(
  name: string,
  table: TableDef<T, S>,
  options?: ResourceOptions<T, InferInsert<S>>
): { module: VelnModule }
```

## Basic Example

```ts
import { defineResource } from 'oakbun'
import { usersTable } from './schema/users'

const commentsResource = defineResource('comments', commentsTable)

app.register(commentsResource.module)
// Registers: GET /comments, GET /comments/:id,
//            POST /comments, PUT /comments/:id, DELETE /comments/:id
```

## With Options

```ts
import { defineResource } from 'oakbun'
import { requireAuth } from './guards/auth.guard'

const postsResource = defineResource('posts', postsTable, {
  prefix: '/blog',   // override default prefix (default: '/<name>')
  routes: {
    index:   { guard: false },            // public list
    show:    { guard: false },            // public detail
    store:   { guard: requireAuth },      // auth required
    update:  { guard: requireAuth },
    destroy: false,                       // disable this route entirely
  },
  model: {
    // Override default model methods
    store: (db) => async (data) => {
      // custom insert logic
      return db.into(postsTable).insert(data)
    },
  },
})
```

## ResourceOptions

| Option | Type | Description |
|---|---|---|
| `prefix` | `string` | URL prefix (default: `/<name>`) |
| `routes.index` | `RouteConfig \| false` | Configure or disable GET / |
| `routes.show` | `RouteConfig \| false` | Configure or disable GET /:id |
| `routes.store` | `RouteConfig \| false` | Configure or disable POST / |
| `routes.update` | `RouteConfig \| false` | Configure or disable PUT /:id |
| `routes.destroy` | `RouteConfig \| false` | Configure or disable DELETE /:id |
| `model` | `ModelOverrides` | Override individual model methods |
| `service` | `ServiceOverrides` | Override individual service methods |

## RouteConfig

```ts
type RouteConfig = {
  guard?:   Guard<BaseCtx>
  summary?: string
} | false
```

Setting a route to `false` removes it entirely.

## Default Model Methods

The auto-generated model provides:

| Method | SQL |
|---|---|
| `index()` | `SELECT * FROM <table>` |
| `show(id)` | `SELECT * WHERE id = ?` — throws `NotFoundError` if absent |
| `store(data)` | `INSERT INTO <table>` |
| `update(id, data)` | `UPDATE <table> WHERE id = ?` — throws `NotFoundError` if absent |
| `destroy(id)` | `DELETE FROM <table> WHERE id = ?` — throws `NotFoundError` if absent |

## Errors

| Error | HTTP Status | When |
|---|---|---|
| `NotFoundError` | 404 | `show`, `update`, `destroy` — row not found |
| `ConflictError` | 409 | `store` — unique constraint violation |

## See Also

- [defineModule](./02-define-module.md)
- [defineModel](./06-define-model.md)
- [defineService](./05-define-service.md)
- [defineTable / column](./09-define-table.md)

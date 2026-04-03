---
title: "defineService"
category: "core"
tags: ["service", "dependency-injection", "builder"]
related: ["defineModel", "defineModule", "definePlugin"]
---

# defineService

Defines a per-request service — a factory function that is instantiated once per request and injected into `ctx` under a named key.

## Signature

```ts
function defineService<TKey extends string>(
  key: TKey
): ServiceBuilder<TKey, Record<never, never>>
```

## Basic Example

```ts
import { defineService } from 'oakbun'

const GreetingService = defineService('greeting')
  .define((_deps) => ({
    greet: (name: string) => `Hello, ${name}!`,
  }))
```

Use in a module:

```ts
defineModule('/greet')
  .use(GreetingService)
  .get('/:name', async (ctx) => {
    return ctx.json({ message: ctx.greeting.greet(ctx.params.name) })
  })
```

## Full Example

```ts
import { defineService } from 'oakbun'
import { UserModel } from './models/user.model'
import { NotFoundError, ConflictError } from 'oakbun'

export const UserService = defineService('users')
  .options({ log: { level: 'debug' } })
  .use(UserModel)
  .define(({ UserModel, logger }) => ({
    findAll: () => UserModel.findAll(),

    findById: async (id: number) => {
      const user = await UserModel.findById(id)
      if (!user) throw new NotFoundError(`User ${id} not found`)
      return user
    },

    create: async (data: { name: string; email: string }) => {
      const existing = await UserModel.findByEmail(data.email)
      if (existing) throw new ConflictError('Email already in use')
      return UserModel.create(data)
    },

    update: async (id: number, data: Partial<{ name: string }>) => {
      const user = await UserModel.findById(id)
      if (!user) throw new NotFoundError(`User ${id} not found`)
      return UserModel.update(id, data)
    },

    remove: async (id: number) => {
      const user = await UserModel.findById(id)
      if (!user) throw new NotFoundError(`User ${id} not found`)
      return UserModel.remove(id)
    },
  }))
```

## ServiceBuilder Methods

| Method | Description |
|---|---|
| `.use(dep)` | Add a `ModelDef` or `ServiceDef` as a dependency |
| `.options(opts)` | Log options |
| `.define(factory)` | Provide the factory function — receives injected deps + `logger` |

## Dependency Injection

Services can depend on models and other services. OakBun detects circular dependencies at startup:

```ts
const PostService = defineService('posts')
  .use(PostModel)
  .use(UserService)        // service dependency
  .define(({ PostModel, users, logger }) => ({
    createWithAuthor: async (data, authorId) => {
      const author = await users.findById(authorId)
      return PostModel.create({ ...data, authorId: author.id })
    },
  }))
```

## Factory Arguments

The factory receives all declared deps merged into a single object, plus `logger`:

```ts
.define(({ MyModel, otherService, logger }) => ({
  // MyModel — from .use(MyModel) (model dep)
  // otherService — from .use(OtherService) (service dep, keyed by service key)
  // logger — always injected; respects .options({ log: { level } })
}))
```

## ServiceDef Type

```ts
interface ServiceDef<TKey, TDef> {
  readonly _serviceKey: TKey
  readonly _deps:       ReadonlyArray<Dep<string, unknown>>
  readonly _options:    BaseOptions
  readonly _factory:    (deps: Record<string, unknown>) => TDef
}
```

## See Also

- [defineModel](./06-define-model.md)
- [defineModule](./02-define-module.md)
- [Error Handling](../guides/01-error-handling.md)

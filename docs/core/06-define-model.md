---
title: "defineModel"
category: "core"
tags: ["model", "database", "builder", "db"]
related: ["defineService", "defineTable", "defineResource"]
---

# defineModel

Defines a DB-backed model — a factory that receives a `BoundVelnDB` and returns an object with query methods. Models are injected into services as dependencies.

## Signature

```ts
// Builder form (recommended)
function defineModel<TName extends string, T>(
  name: TName,
  table: TableDef<T>
): ModelBuilder<TName, T>

// Direct form (compatibility)
function defineModel<TName extends string, T, TDef>(
  name: TName,
  table: TableDef<T>,
  factory: (db: BoundVelnDB, opts: { logger: Logger }) => TDef
): ModelDef<TName, TDef>
```

## Basic Example

```ts
import { defineModel } from 'oakbun'
import { usersTable } from './schema/users'

export const UserModel = defineModel('UserModel', usersTable)
  .define((db) => ({
    findAll: () => db.from(usersTable).select(),
    findById: (id: number) => db.from(usersTable).where({ id }).first(),
    create: (data: UserInsert) => db.into(usersTable).insert(data),
    update: (id: number, data: Partial<UserInsert>) =>
      db.into(usersTable).update({ id }, data),
    remove: (id: number) => db.into(usersTable).delete({ id }),
  }))
```

## Full Example

```ts
import { defineModel } from 'oakbun'
import { usersTable } from './schema/users'
import type { User, UserInsert } from './schema/users'

export const UserModel = defineModel('UserModel', usersTable)
  .options({ log: { level: 'debug' } })
  .define((db, { logger }) => ({
    findAll: async (): Promise<User[]> => {
      const rows = await db.from(usersTable).select()
      logger.debug('findAll', { count: rows.length })
      return rows
    },

    findById: (id: number): Promise<User | undefined> =>
      db.from(usersTable).where({ id }).first(),

    findByEmail: (email: string): Promise<User | undefined> =>
      db.from(usersTable).where({ email }).first(),

    create: (data: UserInsert): Promise<User> =>
      db.into(usersTable).insert(data),

    update: (id: number, data: Partial<UserInsert>): Promise<User> =>
      db.into(usersTable).update({ id }, data),

    remove: (id: number): Promise<User> =>
      db.into(usersTable).delete({ id }),
  }))
```

## ModelBuilder Methods

| Method | Description |
|---|---|
| `.options(opts)` | Log options |
| `.define(factory)` | Provide the factory — receives `(db, { logger })` |

## Using Models in Services

Models are declared as dependencies on services via `.use()`:

```ts
import { defineService } from 'oakbun'
import { UserModel } from './models/user.model'

const UserService = defineService('users')
  .use(UserModel)                            // injects as ctx key matching model name
  .define(({ UserModel, logger }) => ({
    findById: async (id) => {
      const user = await UserModel.findById(id)
      if (!user) throw new NotFoundError(`User ${id} not found`)
      return user
    },
  }))
```

## ModelInstance Type

The factory return value is wrapped with a `.db` accessor:

```ts
type ModelInstance<TDef> = TDef & { readonly db: BoundVelnDB }
```

## ModelDef Type

```ts
interface ModelDef<TName, TDef> {
  readonly _modelName: TName
  readonly _factory:   (db: BoundVelnDB) => ModelInstance<TDef>
}
```

## See Also

- [defineService](./05-define-service.md)
- [defineTable / column](./09-define-table.md)
- [SelectBuilder](../sql/02-select-builder.md)

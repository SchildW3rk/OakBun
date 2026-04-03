# oakbun

Bun-native backend framework — No Magic, just code.

## Installation

```bash
bun add oakbun zod
```

## Quick Start

```ts
import { createApp, defineModule, column, defineTable } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'

const db = new SQLiteAdapter({ filename: 'app.db' })

const users = defineTable('users', {
  id:    column.integer().primaryKey(),
  name:  column.text().notNull(),
  email: column.text().notNull().unique(),
})

const app = createApp({ adapter: db })

app.use(defineModule('users')
  .get('/', async (ctx) => ctx.json(await ctx.db.select(users)))
  .post('/', async (ctx) => {
    const body = await ctx.req.json()
    await ctx.db.insert(users).values(body)
    return ctx.json({ ok: true }, 201)
  })
)

app.listen({ port: 3000 })
```

## Adapters

```ts
import { SQLiteAdapter }  from 'oakbun/adapter/sqlite'
import { PostgresAdapter } from 'oakbun/adapter/postgres'
import { MySQLAdapter }   from 'oakbun/adapter/mysql'
```

## Documentation

Full docs at [oakbun.dev](https://oakbun.dev).

## License

MIT

---
"oakbun": minor
---

feat(cli): pass `ctx` with `db` and `adapter` to custom command actions

`defineCommand().action()` now receives a second argument `ctx: CommandContext`
with a `BoundVelnDB` instance and the raw adapter, both resolved from `oak.config.ts`.

```ts
export default defineCommand('seed')
  .description('Seed the database')
  .action(async (args, ctx) => {
    await ctx.db.into(usersTable).insert({ email: args.email })
  })
```

Closes #2

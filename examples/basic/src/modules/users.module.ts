import { defineModule } from 'oakbun'
import { jwtPlugin }    from '@oakbun/jwt'
import { z }            from 'zod'
import { UserService }  from '../services/user.service'
import { usersTable }   from '../schema/users'
import { auditLogs }    from '../schema/audit'

const SECRET = process.env.JWT_SECRET ?? 'veln-example-secret'

const userSchema = z.object({
  id:        z.number(),
  name:      z.string(),
  email:     z.string(),
  role:      z.string(),
  createdAt: z.union([z.string(), z.date()]),
})

export const usersModule = defineModule('/users')
    .meta({ tag: 'Users', description: 'User management' })
    .plugin(jwtPlugin(SECRET, { optional: true }))
    .use(UserService)
    .hook(usersTable, {
      afterDelete: ctx => {

      }
    })
    .audit(usersTable, {
      storeIn: auditLogs,
      actor:   (ctx) => ctx.jwtUser?.sub ?? null,
    })

  // GET /users — public (no requireAuth)
  .get('/', {
    response: z.array(userSchema),
    handler:  async (ctx) => ctx.json(await ctx.users.findAll()),
  })

  // GET /users/:id — public
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: userSchema,
    handler:  async (ctx) => ctx.json(await ctx.users.findById(ctx.params.id)),
  })

  // POST /users — protected
  .post('/', {
    body:     z.object({ name: z.string().min(1), email: z.string().email(), role: z.string().optional() }),
    response: userSchema,
    handler:  async (ctx) => ctx.json(await ctx.users.create(ctx.body), 201),
  })

  // PATCH /users/:id — protected
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ name: z.string().min(1).optional(), role: z.string().optional() }),
    response: userSchema,
    handler:  async (ctx) => ctx.json(await ctx.users.update(ctx.params.id, ctx.body)),
  })

  // DELETE /users/:id — protected + admin only
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: userSchema,
    handler:  async (ctx) => ctx.json(await ctx.users.remove(ctx.params.id)),
  })

  .build()

import { defineModule }    from 'oakbun'
import { jwtPlugin }       from '@oakbun/jwt'
import { z }               from 'zod'
import { requireAuth }     from '../guards/auth.guard'
import { PostService }     from '../services/post.service'

const SECRET = process.env.JWT_SECRET ?? 'veln-example-secret'

const postSchema = z.object({
  id:        z.number(),
  title:     z.string(),
  body:      z.string(),
  authorId:  z.number(),
  published: z.boolean(),
  createdAt: z.union([z.string(), z.date()]),
})

export const postsModule = defineModule('/posts')
  .meta({ tag: 'Posts', description: 'Blog post management' })
  .plugin(jwtPlugin(SECRET, { optional: true }))
  .use(PostService)
  // Module-level guard — protects all routes by default.
  // Individual routes can opt out with guard: false.
  .guard(requireAuth)

  // GET /posts — public (opt out of module guard)
  .get('/', {
    guard:    false,
    response: z.array(postSchema),
    handler:  async (ctx) => ctx.json(await ctx.posts.findPublished()),
  })

  // GET /posts/all — all posts incl. drafts (inherits module guard)
  .get('/all', {
    response: z.array(postSchema),
    handler:  async (ctx) => ctx.json(await ctx.posts.findAll()),
  })

  // GET /posts/:id — public (opt out of module guard)
  .get('/:id', {
    guard:    false,
    params:   z.object({ id: z.coerce.number() }),
    response: postSchema,
    handler:  async (ctx) => ctx.json(await ctx.posts.findById(ctx.params.id)),
  })

  // POST /posts — inherits module guard (requireAuth)
  .post('/', {
    body: z.object({
      title:     z.string().min(1),
      body:      z.string().min(1),
      published: z.boolean().optional(),
    }),
    response: postSchema,
    handler:  async (ctx) => {
      const post = await ctx.posts.create({
        title:     ctx.body.title,
        body:      ctx.body.body,
        authorId:  Number(ctx.jwtUser?.sub ?? 0),
        published: ctx.body.published ?? false,
      })
      return ctx.json(post, 201)
    },
  })

  // PATCH /posts/:id — inherits module guard (requireAuth)
  .patch('/:id', {
    params: z.object({ id: z.coerce.number() }),
    body:   z.object({
      title:     z.string().min(1).optional(),
      body:      z.string().min(1).optional(),
      published: z.boolean().optional(),
    }),
    response: postSchema,
    handler:  async (ctx) => ctx.json(await ctx.posts.update(ctx.params.id, ctx.body)),
  })

  // DELETE /posts/:id — inherits module guard (requireAuth)
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: postSchema,
    handler:  async (ctx) => ctx.json(await ctx.posts.remove(ctx.params.id)),
  })

  .build()

/**
 * statsReportCron — prints a count of users and posts every minute.
 *
 * Demonstrates:
 *   - defineCron() fluent API with @minute shortcut
 *   - .use(Service) before .handler() — ctx.users and ctx.posts are fully typed
 */

import { defineCron } from 'oakbun'
import { UserService } from '../services/user.service'
import { PostService }  from '../services/post.service'

export const statsReportCron = defineCron('stats.report', '@minute')
  .use(UserService)
  .use(PostService)
  .handler(async (ctx) => {
    const [allUsers, allPosts] = await Promise.all([
      ctx.users.findAll(),
      ctx.posts.findAll(),
    ])
    console.log(`  [stats] users=${allUsers.length}  posts=${allPosts.length}`)
  })

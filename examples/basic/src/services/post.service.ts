import { defineService, NotFoundError } from 'oakbun'
import { PostModel } from '../models/post.model'
import { postsTable } from '../schema/posts'
import type { PostTypes } from '../schema/posts'

export const PostService = defineService('posts')
  .options({ log: { level: 'debug', mask: ['password', 'token'] } })
  .use(PostModel)
  .define(({ PostModel, logger }) => ({
    findAll: () => {
      logger.debug('findAll')
      return PostModel.findAll()
    },

    findById: async (id: number) => {
      logger.debug('findById', { id })
      const post = await PostModel.findById(id)
      if (!post) throw new NotFoundError(`Post ${id} not found`)
      return post
    },

    findPublished: () => {
      logger.debug('findPublished')
      return PostModel.findPublished()
    },

    create: async (data: PostTypes['insert']) => {
      logger.debug('create')
      return PostModel.db.into(postsTable).insert(data)
    },

    update: async (id: number, data: PostTypes['update']) => {
      logger.debug('update', { id })
      const post = await PostModel.findById(id)
      if (!post) throw new NotFoundError(`Post ${id} not found`)
      return PostModel.db.from(postsTable).where({ id }).update(data)
    },

    remove: async (id: number): Promise<PostTypes['row']> => {
      logger.debug('remove', { id })
      const post = await PostModel.findById(id)
      if (!post) throw new NotFoundError(`Post ${id} not found`)
      return PostModel.db.from(postsTable).where({ id }).delete()
    },
  }))

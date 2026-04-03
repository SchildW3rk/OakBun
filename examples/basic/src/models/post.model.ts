import { defineModel } from 'oakbun'
import { postsTable } from '../schema/posts'

export const PostModel = defineModel('PostModel', postsTable)
  .options({ log: { level: 'debug' } })
  .define((db, { logger }) => ({
    findById: (id: number) => {
      logger.debug('findById', { id })
      return db.from(postsTable).where({ id }).first()
    },

    findByAuthor: (authorId: number) => {
      logger.debug('findByAuthor', { authorId })
      return db.from(postsTable).where({ authorId }).select()
    },

    findPublished: () => {
      logger.debug('findPublished')
      return db.from(postsTable).where({ published: true }).select()
    },

    findAll: () => {
      logger.debug('findAll')
      return db.from(postsTable).select()
    },
  }))

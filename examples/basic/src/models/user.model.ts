import { defineModel } from 'oakbun'
import { usersTable } from '../schema/users'

export const UserModel = defineModel('UserModel', usersTable)
  .options({ log: { level: 'debug' } })
  .define((db, { logger }) => ({
    findByEmail: (email: string) => {
      logger.debug('findByEmail', { email })
      return db.from(usersTable).where({ email } as { email: string }).first()
    },

    findById: (id: number) => {
      logger.debug('findById', { id })
      return db.from(usersTable).where({ id } as { id: number }).first()
    },

    findAll: () => {
      logger.debug('findAll')
      return db.from(usersTable).select()
    },
  }))

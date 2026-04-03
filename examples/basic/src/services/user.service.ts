import { defineService, NotFoundError, ConflictError } from 'oakbun'
import { UserModel } from '../models/user.model'
import { usersTable } from '../schema/users'
import type { UserTypes } from '../schema/users'

export const UserService = defineService('users')
  .options({ log: { level: 'debug' } })
  .use(UserModel)
  .define(({ UserModel, logger }) => ({
    findAll: () => {
      logger.debug('findAll')
      return UserModel.findAll()
    },

    findById: async (id: number) => {
      logger.debug('findById', { id })
      const user = await UserModel.findById(id)
      if (!user) throw new NotFoundError(`User ${id} not found`)
      return user
    },

    create: async (data: UserTypes['insert']) => {
      logger.debug('create', { email: data.email })
      const exists = await UserModel.findByEmail(data.email ?? '')
      if (exists) throw new ConflictError('Email already taken')
      return UserModel.db.into(usersTable).insert(data)
    },

    update: async (id: number, data: UserTypes['update']) => {
      logger.debug('update', { id })
      const user = await UserModel.findById(id)
      if (!user) throw new NotFoundError(`User ${id} not found`)
      return UserModel.db.from(usersTable).where({ id } as { id: number }).update(data)
    },

    remove: async (id: number) => {
      logger.debug('remove', { id })
      const user = await UserModel.findById(id)
      if (!user) throw new NotFoundError(`User ${id} not found`)
      return UserModel.db.from(usersTable).where({ id } as { id: number }).delete()
    },
  }))

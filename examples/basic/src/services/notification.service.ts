import { defineService } from 'oakbun'
import { UserModel } from '../models/user.model'

export const NotificationService = defineService('NotificationService')
    .use(UserModel)
    .options({ log: { level: 'info' } })
    .define(({ UserModel, logger }) => ({
        sendWelcome: async (userId: number) => {
          const user = await UserModel.findById(userId)
          if (!user) return
          logger.info(`[NotificationService] sendWelcome: ${user.name}`)
        },
  }))

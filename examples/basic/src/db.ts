import { createMigrator } from 'oakbun'

// Run pending migrations on startup
const migrator = createMigrator({ adapter: 'sqlite' }, { migrationsDir: './migrations' })

await migrator.run()

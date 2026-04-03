/**
 * SQL-H — Migrations: allowDestructive + Migration Hooks
 *
 * allowDestructive: true
 *   Generiert echtes SQL statt auskommentierte Warnings:
 *     ALTER TABLE "users" DROP COLUMN "old_col";
 *     ALTER TABLE "orders" ALTER COLUMN "amount" TYPE REAL;
 *     DROP TABLE IF EXISTS "legacy_table";
 *
 *   Default: false — Kommentare wie bisher, kein Breaking Change.
 *   ⚠️  Immer Review der generierten Migration vor Production-Einsatz.
 *
 * Migration Hooks (alle optional):
 *   onBeforeMigrate({ name, sql })                  — vor jeder Migration
 *   onAfterMigrate({ name, sql, durationMs })        — nach erfolgreicher Migration
 *   onError({ name, error })                         — bei Fehler
 */

import {createMigrator, generateMigration, SQLiteAdapter} from 'oakbun'
import { usersTable, postsTable, ordersTable } from './schema'

// ── Migrator mit Hooks ────────────────────────────────────────────────────────

const adapter = new SQLiteAdapter()

const migrator = createMigrator(adapter, {
  migrationsDir: './migrations',

  onBeforeMigrate: ({ name }) => {
    console.log(`[migrate] running: ${name}`)
  },

  onAfterMigrate: ({ name, durationMs }) => {
    console.log(`[migrate] done:    ${name} (${durationMs.toFixed(1)}ms)`)
  },

  onError: ({ name, error }) => {
    console.error(`[migrate] FAILED:  ${name}`, error.message)
    // z.B. Alert senden, Slack-Notification, etc.
  },
})

// run() führt alle pending Migrations aus, ruft Hooks pro Migration
await migrator.run()

// ── generateMigration — allowDestructive: false (default) ────────────────────

// Standard: Column-Drops und Type-Changes → auskommentiert
await generateMigration({
  tables:        [usersTable, postsTable, ordersTable],
  adapter,
  migrationsDir: './migrations',
  name:          'schema_update',
  // allowDestructive: false (default)
})
// Generiertes SQL für einen Column-Drop:
// -- WARNING: ALTER TABLE "users" DROP COLUMN "old_col" -- uncomment to apply

// ── generateMigration — allowDestructive: true ────────────────────────────────

// Mit Flag: echtes SQL wird generiert
await generateMigration({
  tables:           [usersTable, postsTable, ordersTable],
  adapter,
  migrationsDir:    './migrations',
  name:             'schema_update_destructive',
  allowDestructive: true,   // ⚠️  immer Review vor Production
})
// Generiertes SQL für einen Column-Drop:
// ALTER TABLE "users" DROP COLUMN "old_col";

// ── Vollständiges Startup-Beispiel ────────────────────────────────────────────

export async function runMigrations() {
  const startupMigrator = createMigrator(new SQLiteAdapter(), {
    migrationsDir: './migrations',

    onBeforeMigrate: ({ name }) =>
      console.log(`▶ ${name}`),

    onAfterMigrate: ({ name, durationMs }) =>
      console.log(`✓ ${name} — ${durationMs.toFixed(0)}ms`),

    onError: ({ name, error }) => {
      console.error(`✗ ${name} — ${error.message}`)
      process.exit(1)  // In Production: Migration-Fehler → hartes Stop
    },
  })

  const results = await startupMigrator.run()
  const applied  = results.filter(r => r.success)
  const failed   = results.filter(r => !r.success)

  if (failed.length > 0) {
    throw new Error(`${failed.length} migration(s) failed`)
  }

  if (applied.length > 0) {
    console.log(`Applied ${applied.length} migration(s)`)
  } else {
    console.log('Schema up to date')
  }
}

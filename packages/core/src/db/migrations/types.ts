export interface MigrationRecord {
  id:        number
  name:      string
  appliedAt: Date
}

export interface MigrationStatus {
  name:      string
  status:    'applied' | 'pending'
  appliedAt?: Date
}

export interface MigratorOptions {
  migrationsDir:    string
  tableName?:       string  // default: '_oakbun_migrations'
  onBeforeMigrate?: (migration: { name: string; sql: string }) => void | Promise<void>
  onAfterMigrate?:  (migration: { name: string; sql: string; durationMs: number }) => void | Promise<void>
  onError?:         (migration: { name: string; error: Error }) => void | Promise<void>
}

export interface MigrationResult {
  name:     string
  success:  boolean
  duration: number
  error?:   Error
}

export interface SchemaDiff {
  addedTables:    TableDiff[]
  droppedTables:  string[]
  modifiedTables: TableModification[]
}

export interface TableDiff {
  name:    string
  columns: ColumnDef[]
  indexes: IndexDef[]
}

export interface TableModification {
  name:            string
  addedColumns:    ColumnDef[]
  droppedColumns:  string[]
  modifiedColumns: ColumnModification[]
  addedIndexes:    IndexDef[]
  droppedIndexes:  string[]
}

export interface ColumnDef {
  name:       string
  type:       string
  nullable:   boolean
  default?:   string
  primaryKey: boolean
  unique:     boolean
}

export interface IndexDef {
  name:    string
  columns: string[]
  unique:  boolean
}

export interface ColumnModification {
  name:   string
  before: ColumnDef
  after:  ColumnDef
}

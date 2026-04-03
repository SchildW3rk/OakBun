import type { VelnAdapter } from '../../adapter/types'
import type { TableDiff, ColumnDef, IndexDef } from './types'

// Internal table names to ignore during introspection
const IGNORED_TABLES = new Set([
  '_veln_migrations',
  'sqlite_sequence',
  'sqlite_stat1',
  'sqlite_master',
])

interface PragmaTableInfo {
  cid:        number
  name:       string
  type:       string
  notnull:    number
  dflt_value: string | null
  pk:         number
}

interface PragmaIndexList {
  seq:     number
  name:    string
  unique:  number
  origin:  string
  partial: number
}

interface PragmaIndexInfo {
  seqno: number
  cid:   number
  name:  string
}

interface InformationSchemaColumn {
  column_name:              string
  data_type:                string
  is_nullable:              string
  column_default:           string | null
  ordinal_position:         number
}

interface InformationSchemaConstraint {
  column_name:      string
  constraint_type:  string
  constraint_name:  string
}

interface MySQLColumn {
  COLUMN_NAME:    string
  DATA_TYPE:      string
  IS_NULLABLE:    string
  COLUMN_DEFAULT: string | null
  COLUMN_KEY:     string
  EXTRA:          string
}

interface MySQLIndex {
  INDEX_NAME:   string
  COLUMN_NAME:  string
  NON_UNIQUE:   number
}

async function introspectSQLite(adapter: VelnAdapter): Promise<Map<string, TableDiff>> {
  const tables = await adapter.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  )

  const result = new Map<string, TableDiff>()

  for (const { name } of tables) {
    if (IGNORED_TABLES.has(name)) continue

    const columns = await adapter.query<PragmaTableInfo>(`PRAGMA table_info("${name}")`)
    const indexList = await adapter.query<PragmaIndexList>(`PRAGMA index_list("${name}")`)

    const columnDefs: ColumnDef[] = columns.map(col => ({
      name:       col.name,
      type:       col.type.toUpperCase(),
      nullable:   col.notnull === 0 && col.pk === 0,
      default:    col.dflt_value ?? undefined,
      primaryKey: col.pk > 0,
      unique:     false,  // determined from indexes
    }))

    const indexes: IndexDef[] = []
    for (const idx of indexList) {
      // Skip auto-created indexes for PRIMARY KEY and UNIQUE constraints on columns
      if (idx.origin === 'pk') continue

      const idxInfo = await adapter.query<PragmaIndexInfo>(`PRAGMA index_info("${idx.name}")`)
      const idxCols = idxInfo.sort((a, b) => a.seqno - b.seqno).map(i => i.name)

      // Mark column as unique if single-column unique index
      if (idx.unique && idxCols.length === 1) {
        const col = columnDefs.find(c => c.name === idxCols[0])
        if (col) col.unique = true
      }

      indexes.push({
        name:    idx.name,
        columns: idxCols,
        unique:  idx.unique === 1,
      })
    }

    result.set(name, { name, columns: columnDefs, indexes })
  }

  return result
}

async function introspectPostgres(adapter: VelnAdapter, tableName?: string): Promise<Map<string, TableDiff>> {
  const tableFilter = tableName ? `AND t.table_name = '${tableName}'` : ''

  const columns = await adapter.query<InformationSchemaColumn>(`
    SELECT
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      c.ordinal_position
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      ${tableFilter}
    ORDER BY c.table_name, c.ordinal_position
  `)

  const constraints = await adapter.query<InformationSchemaConstraint & { table_name: string }>(`
    SELECT
      kcu.column_name,
      tc.constraint_type,
      tc.constraint_name,
      kcu.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  `)

  const pkMap    = new Map<string, Set<string>>()
  const uniqueMap = new Map<string, Set<string>>()
  for (const c of constraints) {
    const tbl = c.table_name
    if (c.constraint_type === 'PRIMARY KEY') {
      if (!pkMap.has(tbl)) pkMap.set(tbl, new Set())
      pkMap.get(tbl)!.add(c.column_name)
    } else if (c.constraint_type === 'UNIQUE') {
      if (!uniqueMap.has(tbl)) uniqueMap.set(tbl, new Set())
      uniqueMap.get(tbl)!.add(c.column_name)
    }
  }

  const tableMap = new Map<string, TableDiff>()
  for (const col of columns) {
    // Extract table name from the query — we need to join differently
    // We'll re-query with table_name included
    break
  }

  // Re-query with table_name
  const fullColumns = await adapter.query<InformationSchemaColumn & { table_name: string }>(`
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      c.ordinal_position
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      ${tableFilter}
    ORDER BY c.table_name, c.ordinal_position
  `)

  for (const col of fullColumns) {
    const tbl = col.table_name
    if (IGNORED_TABLES.has(tbl)) continue

    if (!tableMap.has(tbl)) tableMap.set(tbl, { name: tbl, columns: [], indexes: [] })

    const tableDiff = tableMap.get(tbl)!
    tableDiff.columns.push({
      name:       col.column_name,
      type:       col.data_type.toUpperCase(),
      nullable:   col.is_nullable === 'YES',
      default:    col.column_default ?? undefined,
      primaryKey: pkMap.get(tbl)?.has(col.column_name) ?? false,
      unique:     uniqueMap.get(tbl)?.has(col.column_name) ?? false,
    })
  }

  return tableMap
}

async function introspectMySQL(adapter: VelnAdapter): Promise<Map<string, TableDiff>> {
  const dbRow = await adapter.query<{ database: string }>(`SELECT DATABASE() AS \`database\``)
  const dbName = dbRow[0]?.database ?? ''

  const columns = await adapter.query<MySQLColumn & { TABLE_NAME: string }>(`
    SELECT
      TABLE_NAME,
      COLUMN_NAME,
      DATA_TYPE,
      IS_NULLABLE,
      COLUMN_DEFAULT,
      COLUMN_KEY,
      EXTRA
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = '${dbName}'
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `)

  const indexes = await adapter.query<MySQLIndex & { TABLE_NAME: string }>(`
    SELECT
      TABLE_NAME,
      INDEX_NAME,
      COLUMN_NAME,
      NON_UNIQUE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = '${dbName}'
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
  `)

  const tableMap = new Map<string, TableDiff>()

  for (const col of columns) {
    const tbl = col.TABLE_NAME
    if (IGNORED_TABLES.has(tbl)) continue

    if (!tableMap.has(tbl)) tableMap.set(tbl, { name: tbl, columns: [], indexes: [] })

    tableMap.get(tbl)!.columns.push({
      name:       col.COLUMN_NAME,
      type:       col.DATA_TYPE.toUpperCase(),
      nullable:   col.IS_NULLABLE === 'YES',
      default:    col.COLUMN_DEFAULT ?? undefined,
      primaryKey: col.COLUMN_KEY === 'PRI',
      unique:     col.COLUMN_KEY === 'UNI',
    })
  }

  // Group index rows into IndexDef entries
  const indexBuffer = new Map<string, { tableName: string; name: string; columns: string[]; unique: boolean }>()
  for (const idx of indexes) {
    const key = `${idx.TABLE_NAME}.${idx.INDEX_NAME}`
    if (!indexBuffer.has(key)) {
      indexBuffer.set(key, {
        tableName: idx.TABLE_NAME,
        name:      idx.INDEX_NAME,
        columns:   [],
        unique:    idx.NON_UNIQUE === 0,
      })
    }
    indexBuffer.get(key)!.columns.push(idx.COLUMN_NAME)
  }

  for (const entry of indexBuffer.values()) {
    const tbl = tableMap.get(entry.tableName)
    if (!tbl) continue
    if (entry.name === 'PRIMARY') continue  // already captured via primaryKey flag
    tbl.indexes.push({ name: entry.name, columns: entry.columns, unique: entry.unique })
  }

  return tableMap
}

/**
 * Detect adapter type and introspect the current DB schema.
 * Returns a map of table name → TableDiff.
 */
export async function introspectSchema(adapter: VelnAdapter): Promise<Map<string, TableDiff>> {
  // Probe: if sqlite_master exists → SQLite
  try {
    await adapter.query(`SELECT 1 FROM sqlite_master LIMIT 1`)
    return introspectSQLite(adapter)
  } catch {
    // Not SQLite — try Postgres
  }

  try {
    await adapter.query(`SELECT current_database()`)
    return introspectPostgres(adapter)
  } catch {
    // Not Postgres — try MySQL
  }

  return introspectMySQL(adapter)
}

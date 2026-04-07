import type { TableDef as TableDefSchema } from '../../schema/table'
import type { Column } from '../../schema/column'
import type { SchemaMap } from '../../schema/table'
import type {
  SchemaDiff,
  TableDiff,
  TableModification,
  ColumnDef,
  IndexDef,
  ColumnModification,
} from './types'

function tableDefToColumnDefs(schema: SchemaMap): ColumnDef[] {
  return Object.entries(schema).map(([name, col]) => {
    const c = col as Column<unknown>

    // Map SqlType → generic SQL type string
    let type: string
    switch (c.def.type) {
      case 'INTEGER':   type = 'INTEGER';   break
      case 'TEXT':
      case 'UUID':      type = 'TEXT';      break
      case 'REAL':      type = 'REAL';      break
      case 'BOOLEAN':   type = 'INTEGER';   break  // SQLite stores as INTEGER
      case 'TIMESTAMP': type = 'TEXT';      break  // ISO string
      case 'JSON':      type = 'TEXT';      break
      case 'BLOB':      type = 'BLOB';      break
      default:          type = 'TEXT';      break
    }

    return {
      name,
      type,
      nullable:   c.def.nullable,
      default:    c.def.defaultValue !== undefined ? String(c.def.defaultValue) : undefined,
      primaryKey: c.def.primaryKey,
      unique:     c.def.unique,
    }
  })
}

function columnsEqual(a: ColumnDef, b: ColumnDef): boolean {
  return (
    a.type      === b.type      &&
    a.nullable  === b.nullable  &&
    a.primaryKey === b.primaryKey &&
    a.unique    === b.unique    &&
    (a.default ?? null) === (b.default ?? null)
  )
}

export function compareSchemas(
  current: Map<string, TableDiff>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target:  TableDefSchema<any, SchemaMap>[],
): SchemaDiff {
  const addedTables:    TableDiff[]          = []
  const droppedTables:  string[]             = []
  const modifiedTables: TableModification[]  = []

  const targetNames = new Set(target.map(t => t.name))

  // Dropped tables: in current but not in target
  for (const [name] of current) {
    if (!targetNames.has(name)) {
      droppedTables.push(name)
    }
  }

  for (const table of target) {
    const currentTable = current.get(table.name)
    const targetColumns = tableDefToColumnDefs(table.schema)

    if (!currentTable) {
      // New table
      addedTables.push({
        name:    table.name,
        columns: targetColumns,
        indexes: [],  // TODO: index extraction from schema when supported
      })
      continue
    }

    // Compare columns
    const currentColMap = new Map(currentTable.columns.map(c => [c.name, c]))
    const targetColMap  = new Map(targetColumns.map(c => [c.name, c]))

    const addedColumns:    ColumnDef[]          = []
    const droppedColumns:  string[]             = []
    const modifiedColumns: ColumnModification[] = []
    const addedIndexes:    IndexDef[]           = []
    const droppedIndexes:  string[]             = []

    for (const [name, col] of targetColMap) {
      const existing = currentColMap.get(name)
      if (!existing) {
        addedColumns.push(col)
      } else if (!columnsEqual(existing, col)) {
        modifiedColumns.push({ name, before: existing, after: col })
      }
    }

    for (const [name] of currentColMap) {
      if (!targetColMap.has(name)) {
        droppedColumns.push(name)
      }
    }

    const hasChanges =
      addedColumns.length    > 0 ||
      droppedColumns.length  > 0 ||
      modifiedColumns.length > 0 ||
      addedIndexes.length    > 0 ||
      droppedIndexes.length  > 0

    if (hasChanges) {
      modifiedTables.push({
        name: table.name,
        addedColumns,
        droppedColumns,
        modifiedColumns,
        addedIndexes,
        droppedIndexes,
      })
    }
  }

  return { addedTables, droppedTables, modifiedTables }
}

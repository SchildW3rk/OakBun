import type { BindingValue } from '../adapter/types'
import type { TableDef, SchemaMap } from '../schema/table'
import type { Column } from '../schema/column'
import { VelnError } from '../errors/index'

// ── JOIN types ────────────────────────────────────────────────────────────────

export interface JoinClause {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  table: string
  on: string
}

// ── validateAndQuoteOnClause ──────────────────────────────────────────────────
// Validates and quotes a JOIN ON clause to prevent SQL injection.
// Only allows the format: word.word = word.word (table.column = table.column)
// Throws VelnError(500, INVALID_JOIN_ON) for anything that doesn't match.

const ON_CLAUSE_PATTERN = /^([\w]+)\.([\w]+)\s*=\s*([\w]+)\.([\w]+)$/

export function validateAndQuoteOnClause(on: string): string {
  const trimmed = on.trim()
  const match = ON_CLAUSE_PATTERN.exec(trimmed)
  if (!match) {
    throw new VelnError(
      `Invalid JOIN ON clause: "${on}". Must be in format "table.column = table.column"`,
      500,
      'INVALID_JOIN_ON',
    )
  }
  const [, t1, c1, t2, c2] = match
  return `"${t1}"."${c1}" = "${t2}"."${c2}"`
}

// ── WHERE operator types ──────────────────────────────────────────────────────

/** SQL dialect — used for ILIKE fallback on non-Postgres adapters. */
export type SqlDialect = 'sqlite' | 'postgres' | 'mysql'

/** Explicit operator condition for a single column. */
export type WhereOp<T> =
  | { op: '=';          value: T }
  | { op: '!=';         value: T }
  | { op: '>';          value: T }
  | { op: '>=';         value: T }
  | { op: '<';          value: T }
  | { op: '<=';         value: T }
  | { op: 'IN';         value: T[] }
  | { op: 'NOT IN';     value: T[] }
  | { op: 'LIKE';       value: string }
  | { op: 'ILIKE';      value: string }
  | { op: 'IS NULL' }
  | { op: 'IS NOT NULL' }

/** Per-field condition — shorthand (plain value = equality) or explicit operator. */
export type FieldCondition<T> = T | WhereOp<T>

/** Map of column conditions — each field is optional. */
export type WhereConditions<TRow> = {
  [K in keyof TRow]?: FieldCondition<TRow[K]>
}

/**
 * Full WHERE input — either a flat conditions map, OR-group, or AND-group.
 * OR/AND values are recursively WhereInput allowing nesting.
 */
export type WhereInput<TRow> =
  | WhereConditions<TRow>
  | { OR: WhereInput<TRow>[] }
  | { AND: WhereInput<TRow>[] }

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Filter out undefined values from a record.
 * null is a valid BindingValue and is kept.
 */
function filterDefined(data: Record<string, unknown>): [string, BindingValue][] {
  return Object.entries(data).filter(
    (entry): entry is [string, BindingValue] => entry[1] !== undefined,
  )
}

/** Type guard: is the value a WhereOp object (has an `op` string key)? */
function isWhereOp(val: unknown): val is WhereOp<unknown> {
  return typeof val === 'object' && val !== null && 'op' in val && typeof (val as Record<string, unknown>)['op'] === 'string'
}

/**
 * Compile a single column + condition into SQL fragment + params.
 * Handles all WhereOp variants and the shorthand equality case.
 */
function buildFieldCondition(
  key: string,
  condition: unknown,
  dialect: SqlDialect,
): { sql: string; params: BindingValue[] } {
  if (!isWhereOp(condition)) {
    // Shorthand: plain value → equality
    return { sql: `"${key}" = ?`, params: [condition as BindingValue] }
  }

  const op = condition as WhereOp<unknown>

  switch (op.op) {
    case '=':
      return { sql: `"${key}" = ?`, params: [op.value as BindingValue] }
    case '!=':
      return { sql: `"${key}" != ?`, params: [op.value as BindingValue] }
    case '>':
      return { sql: `"${key}" > ?`, params: [op.value as BindingValue] }
    case '>=':
      return { sql: `"${key}" >= ?`, params: [op.value as BindingValue] }
    case '<':
      return { sql: `"${key}" < ?`, params: [op.value as BindingValue] }
    case '<=':
      return { sql: `"${key}" <= ?`, params: [op.value as BindingValue] }
    case 'IN': {
      const vals = op.value as unknown[]
      if (vals.length === 0) {
        // IN () is invalid SQL — use a false literal so no rows match
        return { sql: '1 = 0', params: [] }
      }
      const placeholders = vals.map(() => '?').join(', ')
      return { sql: `"${key}" IN (${placeholders})`, params: vals as BindingValue[] }
    }
    case 'NOT IN': {
      const vals = op.value as unknown[]
      if (vals.length === 0) {
        // NOT IN () matches everything — use a true literal
        return { sql: '1 = 1', params: [] }
      }
      const placeholders = vals.map(() => '?').join(', ')
      return { sql: `"${key}" NOT IN (${placeholders})`, params: vals as BindingValue[] }
    }
    case 'LIKE':
      return { sql: `"${key}" LIKE ?`, params: [op.value as BindingValue] }
    case 'ILIKE':
      if (dialect === 'postgres') {
        return { sql: `"${key}" ILIKE ?`, params: [op.value as BindingValue] }
      }
      // SQLite / MySQL fallback: LOWER(col) LIKE LOWER(?)
      return { sql: `LOWER("${key}") LIKE LOWER(?)`, params: [op.value as BindingValue] }
    case 'IS NULL':
      return { sql: `"${key}" IS NULL`, params: [] }
    case 'IS NOT NULL':
      return { sql: `"${key}" IS NOT NULL`, params: [] }
  }
}

// ── Pure SQL generation functions (SQLite dialect — ? as placeholder) ──────

/**
 * Build a WHERE clause from a WhereInput.
 *
 * Supports:
 * - Shorthand equality:  { name: 'Alice' }           → "name" = ?
 * - Explicit operator:   { age: { op: '>=', value: 18 } }
 * - IN / NOT IN:         { id: { op: 'IN', value: [1,2,3] } }
 * - IS NULL / IS NOT NULL
 * - LIKE / ILIKE (ILIKE falls back to LOWER() on SQLite/MySQL)
 * - OR groups:           { OR: [{ role: 'admin' }, { role: 'mod' }] }
 * - AND groups:          { AND: [...] }
 * - Nested OR/AND
 *
 * Returns { sql: '', params: [] } for empty / all-undefined conditions.
 */
export function buildWhere(
  conditions: WhereInput<Record<string, unknown>>,
  dialect: SqlDialect = 'sqlite',
): { sql: string; params: BindingValue[] } {
  // OR group
  if ('OR' in conditions && Array.isArray((conditions as { OR: unknown }).OR)) {
    const branches = (conditions as { OR: WhereInput<Record<string, unknown>>[] }).OR
    const parts: string[] = []
    const params: BindingValue[] = []
    for (const branch of branches) {
      const { sql, params: p } = buildWhere(branch, dialect)
      if (sql) {
        parts.push(sql)
        params.push(...p)
      }
    }
    if (parts.length === 0) return { sql: '', params: [] }
    if (parts.length === 1) return { sql: parts[0]!, params }
    return { sql: `(${parts.join(' OR ')})`, params }
  }

  // AND group
  if ('AND' in conditions && Array.isArray((conditions as { AND: unknown }).AND)) {
    const branches = (conditions as { AND: WhereInput<Record<string, unknown>>[] }).AND
    const parts: string[] = []
    const params: BindingValue[] = []
    for (const branch of branches) {
      const { sql, params: p } = buildWhere(branch, dialect)
      if (sql) {
        parts.push(sql)
        params.push(...p)
      }
    }
    if (parts.length === 0) return { sql: '', params: [] }
    if (parts.length === 1) return { sql: parts[0]!, params }
    return { sql: `(${parts.join(' AND ')})`, params }
  }

  // Flat conditions map
  const entries = Object.entries(conditions).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return { sql: '', params: [] }

  const sqlParts: string[] = []
  const params: BindingValue[] = []

  for (const [key, value] of entries) {
    const { sql, params: p } = buildFieldCondition(key, value, dialect)
    sqlParts.push(sql)
    params.push(...p)
  }

  return { sql: sqlParts.join(' AND '), params }
}

/**
 * Build an INSERT statement.
 * INSERT INTO "table" ("col1", "col2") VALUES (?, ?) RETURNING *
 *
 * RETURNING * (SQLite ≥ 3.35, PostgreSQL) returns the inserted row, avoiding
 * a second SELECT round-trip. Pass returning: false for databases that do not
 * support RETURNING (MySQL).
 */
export function buildInsert(
  tableName: string,
  data: Record<string, unknown>,
  returning = true,
): { sql: string; params: BindingValue[] } {
  const entries = filterDefined(data)
  const cols   = entries.map(([key]) => `"${key}"`).join(', ')
  const placeholders = entries.map(() => '?').join(', ')
  const params = entries.map(([, val]) => val)
  const returning_clause = returning ? ' RETURNING *' : ''
  const sql = `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})${returning_clause}`
  return { sql, params }
}

/**
 * Build an UPDATE statement.
 * UPDATE "table" SET "col1" = ?, "col2" = ? WHERE "pk" = ?
 * The pk param is always last in params.
 */
export function buildUpdate(
  tableName: string,
  patch: Record<string, unknown>,
  pk: string,
  pkValue: BindingValue,
): { sql: string; params: BindingValue[] } {
  const entries = filterDefined(patch)
  const sets   = entries.map(([key]) => `"${key}" = ?`).join(', ')
  const params: BindingValue[] = [...entries.map(([, val]) => val), pkValue]
  const sql = `UPDATE "${tableName}" SET ${sets} WHERE "${pk}" = ?`
  return { sql, params }
}

/**
 * Build a DELETE statement.
 * DELETE FROM "table" WHERE "pk" = ?
 */
export function buildDelete(
  tableName: string,
  pk: string,
  pkValue: BindingValue,
): { sql: string; params: BindingValue[] } {
  const sql = `DELETE FROM "${tableName}" WHERE "${pk}" = ?`
  return { sql, params: [pkValue] }
}

/**
 * Deserialize a raw DB row into the typed T shape.
 * Consolidated here to avoid duplication between SelectBuilder and InsertBuilder.
 * Handles TIMESTAMP columns: SQLite stores them as ISO strings, we convert back to Date.
 */
export function deserializeRow<T, S extends SchemaMap>(
  table: TableDef<T, S>,
  row: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = {}
  for (const [key, col] of Object.entries(table.schema)) {
    const c = col as Column<unknown>
    const raw = row[key]
    if (c.def.type === 'TIMESTAMP' && raw !== null && raw !== undefined) {
      result[key] = new Date(raw as string)
    } else {
      result[key] = raw
    }
  }
  return result as T
}

/** A single aggregate expression: FN("col") AS alias. */
export interface AggregateClause {
  alias: string
  fn:    'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
  col?:  string   // undefined → COUNT(*)
}

export interface SelectOptions {
  limit?:      number
  offset?:     number
  orderBy?:    { col: string; dir: 'ASC' | 'DESC' }[]
  columns?:    string[]            // explicit column list — overrides SELECT *
  groupBy?:    string[]            // GROUP BY columns
  aggregates?: AggregateClause[]  // aggregate expressions added to SELECT
  having?:     WhereInput<Record<string, unknown>>  // HAVING clause
}

/** Build the SELECT column list from options. Exported for use in SelectBuilder's raw-where path. */
export function buildSelectListFromOptions(options?: SelectOptions): string {
  const cols: string[] = []

  // Explicit column selection
  if (options?.columns && options.columns.length > 0) {
    cols.push(...options.columns.map((c) => `"${c}"`))
  } else if (!options?.aggregates || options.aggregates.length === 0) {
    // No columns + no aggregates → SELECT *
    cols.push('*')
  } else if (options?.groupBy && options.groupBy.length > 0) {
    // Aggregates + GROUP BY → include the group-by columns so they appear in results
    cols.push(...options.groupBy.map((c) => `"${c}"`))
  } else {
    // Aggregates only (no groupBy columns) → e.g. SELECT COUNT(*)
  }

  // Aggregate expressions appended after regular columns
  if (options?.aggregates && options.aggregates.length > 0) {
    for (const agg of options.aggregates) {
      const colExpr = agg.col ? `"${agg.col}"` : '*'
      cols.push(`${agg.fn}(${colExpr}) AS "${agg.alias}"`)
    }
  }

  return cols.length > 0 ? cols.join(', ') : '*'
}

/** Append ORDER BY / LIMIT / OFFSET to parts[]. Shared between buildSelect paths. */
function appendPaginationAndOrder(
  parts: string[],
  options?: SelectOptions,
): void {
  if (options?.orderBy && options.orderBy.length > 0) {
    const clause = options.orderBy
      .map(({ col, dir }) => `"${col}" ${dir}`)
      .join(', ')
    parts.push(`ORDER BY ${clause}`)
  }

  // LIMIT and OFFSET are always non-negative integers supplied by framework code,
  // never from raw user input — safe to inline as literals.
  // SQLite does not support ? placeholders in LIMIT/OFFSET positions.
  // SQLite also requires LIMIT to precede OFFSET — if only offset is set,
  // use LIMIT -1 (SQLite's "unlimited" sentinel).
  if (options?.limit !== undefined || options?.offset !== undefined) {
    const limitVal = options?.limit !== undefined
      ? Math.trunc(Math.max(0, options.limit))
      : -1  // -1 = unlimited in SQLite/PostgreSQL/MySQL
    parts.push(`LIMIT ${limitVal}`)

    if (options?.offset !== undefined) {
      parts.push(`OFFSET ${Math.trunc(Math.max(0, options.offset))}`)
    }
  }
}

/**
 * Build a SELECT statement.
 * SELECT [cols] FROM "table" [WHERE ...] [GROUP BY ...] [HAVING ...] [ORDER BY ...] [LIMIT n] [OFFSET n]
 */
export function buildSelect(
  tableName: string,
  conditions: WhereInput<Record<string, unknown>>,
  options?: SelectOptions,
  dialect: SqlDialect = 'sqlite',
): { sql: string; params: BindingValue[] } {
  const selectList = buildSelectListFromOptions(options)
  const { sql: whereSql, params } = buildWhere(conditions, dialect)

  const parts: string[] = [
    whereSql
      ? `SELECT ${selectList} FROM "${tableName}" WHERE ${whereSql}`
      : `SELECT ${selectList} FROM "${tableName}"`,
  ]

  // GROUP BY
  if (options?.groupBy && options.groupBy.length > 0) {
    parts.push(`GROUP BY ${options.groupBy.map((c) => `"${c}"`).join(', ')}`)
  }

  // HAVING — uses same buildWhere system as WHERE
  if (options?.having) {
    const { sql: havingSql, params: havingParams } = buildWhere(options.having, dialect)
    if (havingSql) {
      parts.push(`HAVING ${havingSql}`)
      params.push(...havingParams)
    }
  }

  appendPaginationAndOrder(parts, options)

  return { sql: parts.join(' '), params }
}

/**
 * Build a SELECT statement with JOIN clauses and a raw WHERE condition.
 *
 * columns — explicit column list (e.g. ['orders.id', 'users.name']); defaults to *
 * joins   — ordered list of JOIN clauses
 * where   — optional raw SQL fragment (e.g. 'orders.status = ?')
 * params  — bind values for the where clause
 */
// ── quoteColumnRef ────────────────────────────────────────────────────────────
// Quotes a column reference: "table"."column", "*", or "column".

function quoteColumnRef(col: string): string {
  if (col === '*') return '*'
  const dotIdx = col.indexOf('.')
  if (dotIdx !== -1) {
    const table  = col.slice(0, dotIdx)
    const column = col.slice(dotIdx + 1)
    if (column === '*') return `"${table}".*`
    return `"${table}"."${column}"`
  }
  return `"${col}"`
}

export function buildJoinSelect(
  tableName: string,
  columns: string[],
  joins: JoinClause[],
  where: string,
  params: BindingValue[],
  options?: SelectOptions,
): { sql: string; params: BindingValue[] } {
  const cols = columns.length > 0
    ? columns.map(quoteColumnRef).join(', ')
    : '*'
  const parts: string[] = [`SELECT ${cols} FROM "${tableName}"`]

  for (const j of joins) {
    const quotedOn = validateAndQuoteOnClause(j.on)
    parts.push(`${j.type} JOIN "${j.table}" ON ${quotedOn}`)
  }

  if (where) parts.push(`WHERE ${where}`)

  // Mutable copy — no additional params needed (pagination uses literals)
  const allParams = [...params]

  appendPaginationAndOrder(parts, options)

  return { sql: parts.join('\n'), params: allParams }
}

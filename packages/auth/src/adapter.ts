import { createAdapterFactory } from 'better-auth/adapters'
import type { OakBunAdapter, BindingValue } from 'oakbun'
import { convertWhere } from './where.js'

// createOakBunDbAdapter returns a DBAdapterInstance: (options) => DBAdapter
// which is what betterAuth({ database: ... }) expects.
//
// We use createAdapterFactory which handles:
// - ID generation (nanoid) before calling our CustomAdapter
// - Field name mapping (camelCase → fieldName if configured)
// - Boolean serialization (boolean → 0/1 when supportsBooleans: false)
// - Date serialization (Date → ISO string when supportsDates: false)
// - Transform input/output pipeline
//
// Our CustomAdapter only needs to do raw SQL.
export function createOakBunDbAdapter(oakBunAdapter: OakBunAdapter) {
  let factoryRef: ReturnType<typeof createAdapterFactory> | null = null

  const adapterFactory = createAdapterFactory({
    config: {
      adapterId: 'oakbun-sqlite',
      adapterName: 'OakBun SQLite Adapter',
      usePlural: false,
      supportsBooleans: false,  // we store 0/1
      supportsDates: false,     // we store ISO strings
      supportsJSON: false,
      supportsArrays: false,
      transaction: async (cb) => {
        // transaction is called by better-auth with a callback that accepts a DBTransactionAdapter.
        // We run inside oakBunAdapter.transaction and pass cb a new adapter backed by the tx.
        return oakBunAdapter.transaction((tx) => {
          if (!factoryRef) throw new Error('[oakbun-auth] adapter factory not initialized')
          // Safe cast: createAdapterFactory returns a factory that matches the expected type
          const txAdapter = factoryRef({}) as unknown as Parameters<typeof cb>[0]
          return cb(txAdapter)
        })
      },
    },
    adapter: ({ getModelName }) => ({
      create: async <T extends Record<string, unknown>>({ model, data, select }: {
        model: string
        data: T
        select?: string[]
      }): Promise<T> => {
        const tableName = getModelName(model)
        const fields = Object.keys(data)
        const values = Object.values(data).map(toBindingParam)
        const cols = fields.map((f) => `"${f}"`).join(', ')
        const placeholders = fields.map(() => '?').join(', ')

        await oakBunAdapter.execute(
          `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`,
          values,
        )

        // Fetch the created row back by id
        const idVal = (data as Record<string, unknown>)['id']
        if (idVal !== undefined) {
          const selectCols = buildSelectCols(select)
          const rows = await oakBunAdapter.query<Record<string, unknown>>(
            `SELECT ${selectCols} FROM "${tableName}" WHERE "id" = ? LIMIT 1`,
            [toBindingParam(idVal)],
          )
          return (rows[0] ?? data) as T
        }
        return data
      },

      findOne: async <T>({ model, where, select }: {
        model: string
        where: import('better-auth').Where[]
        select?: string[]
      }): Promise<T | null> => {
        const tableName = getModelName(model)
        const { sql: whereSql, params } = convertWhere(where)
        const selectCols = buildSelectCols(select)
        const whereClause = whereSql ? `WHERE ${whereSql}` : ''
        const rows = await oakBunAdapter.query<Record<string, unknown>>(
          `SELECT ${selectCols} FROM "${tableName}" ${whereClause} LIMIT 1`,
          params,
        )
        return (rows[0] ?? null) as T | null
      },

      findMany: async <T>({ model, where, limit, select, sortBy, offset }: {
        model: string
        where?: import('better-auth').Where[]
        limit: number
        select?: string[]
        sortBy?: { field: string; direction: 'asc' | 'desc' }
        offset?: number
      }): Promise<T[]> => {
        const tableName = getModelName(model)
        const { sql: whereSql, params } = convertWhere(where ?? [])
        const selectCols = buildSelectCols(select)
        const whereClause = whereSql ? `WHERE ${whereSql}` : ''
        const orderClause = sortBy
          ? `ORDER BY "${sortBy.field}" ${sortBy.direction === 'desc' ? 'DESC' : 'ASC'}`
          : ''
        const limitClause = limit !== undefined ? `LIMIT ${limit}` : ''
        const offsetClause = offset !== undefined ? `OFFSET ${offset}` : ''
        const sql = [
          `SELECT ${selectCols} FROM "${tableName}"`,
          whereClause,
          orderClause,
          limitClause,
          offsetClause,
        ]
          .filter(Boolean)
          .join(' ')
        return oakBunAdapter.query<T>(sql, params)
      },

      count: async ({ model, where }: {
        model: string
        where?: import('better-auth').Where[]
      }): Promise<number> => {
        const tableName = getModelName(model)
        const { sql: whereSql, params } = convertWhere(where ?? [])
        const whereClause = whereSql ? `WHERE ${whereSql}` : ''
        const rows = await oakBunAdapter.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM "${tableName}" ${whereClause}`,
          params,
        )
        return rows[0]?.count ?? 0
      },

      update: async <T>({ model, where, update }: {
        model: string
        where: import('better-auth').Where[]
        update: T
      }): Promise<T | null> => {
        const tableName = getModelName(model)
        const { sql: whereSql, params: whereParams } = convertWhere(where)
        if (!whereSql) return null
        const updateObj = update as Record<string, unknown>
        const fields = Object.keys(updateObj)
        if (fields.length === 0) return null
        const setCols = fields.map((f) => `"${f}" = ?`).join(', ')
        const setValues = Object.values(updateObj).map(toBindingParam)
        await oakBunAdapter.execute(
          `UPDATE "${tableName}" SET ${setCols} WHERE ${whereSql}`,
          [...setValues, ...whereParams],
        )
        const rows = await oakBunAdapter.query<Record<string, unknown>>(
          `SELECT * FROM "${tableName}" WHERE ${whereSql} LIMIT 1`,
          whereParams,
        )
        return (rows[0] ?? null) as T | null
      },

      updateMany: async ({ model, where, update }: {
        model: string
        where: import('better-auth').Where[]
        update: Record<string, unknown>
      }): Promise<number> => {
        const tableName = getModelName(model)
        const { sql: whereSql, params: whereParams } = convertWhere(where)
        if (!whereSql) return 0
        const fields = Object.keys(update)
        if (fields.length === 0) return 0
        const setCols = fields.map((f) => `"${f}" = ?`).join(', ')
        const setValues = Object.values(update).map(toBindingParam)
        const result = await oakBunAdapter.execute(
          `UPDATE "${tableName}" SET ${setCols} WHERE ${whereSql}`,
          [...setValues, ...whereParams],
        )
        return result.rowsAffected
      },

      delete: async ({ model, where }: {
        model: string
        where: import('better-auth').Where[]
      }): Promise<void> => {
        const tableName = getModelName(model)
        const { sql: whereSql, params } = convertWhere(where)
        if (!whereSql) return
        await oakBunAdapter.execute(`DELETE FROM "${tableName}" WHERE ${whereSql}`, params)
      },

      deleteMany: async ({ model, where }: {
        model: string
        where: import('better-auth').Where[]
      }): Promise<number> => {
        const tableName = getModelName(model)
        const { sql: whereSql, params } = convertWhere(where)
        if (!whereSql) return 0
        const result = await oakBunAdapter.execute(
          `DELETE FROM "${tableName}" WHERE ${whereSql}`,
          params,
        )
        return result.rowsAffected
      },
    }),
  })

  factoryRef = adapterFactory

  return adapterFactory
}

// Convert a value to a SQLite-compatible binding parameter.
// Handles Date → ISO string, boolean → 0/1, null/undefined → null.
// Note: createAdapterFactory already handles boolean/date transformation BEFORE
// passing to our CustomAdapter, but this handles raw values we build ourselves.
function toBindingParam(value: unknown): BindingValue {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return value
  return String(value)
}

function buildSelectCols(select: string[] | undefined): string {
  if (!select || select.length === 0) return '*'
  return select.map((c) => `"${c}"`).join(', ')
}

import type { BindingValue } from 'oakbun'
import type { Where } from 'better-auth'

export function convertWhere(where: Where[]): { sql: string; params: BindingValue[] } {
  if (where.length === 0) return { sql: '', params: [] }

  const parts: string[] = []
  const params: BindingValue[] = []

  for (const clause of where) {
    const { field, operator = 'eq', value, connector = 'AND' } = clause

    let sql: string
    switch (operator) {
      case 'eq':
        sql = `"${field}" = ?`
        params.push(toBindingValue(value))
        break
      case 'ne':
        sql = `"${field}" != ?`
        params.push(toBindingValue(value))
        break
      case 'lt':
        sql = `"${field}" < ?`
        params.push(toBindingValue(value))
        break
      case 'lte':
        sql = `"${field}" <= ?`
        params.push(toBindingValue(value))
        break
      case 'gt':
        sql = `"${field}" > ?`
        params.push(toBindingValue(value))
        break
      case 'gte':
        sql = `"${field}" >= ?`
        params.push(toBindingValue(value))
        break
      case 'in': {
        const arr = value as string[] | number[]
        const placeholders = arr.map(() => '?').join(',')
        sql = `"${field}" IN (${placeholders})`
        for (const v of arr) params.push(v)
        break
      }
      case 'not_in': {
        const arr = value as string[] | number[]
        const placeholders = arr.map(() => '?').join(',')
        sql = `"${field}" NOT IN (${placeholders})`
        for (const v of arr) params.push(v)
        break
      }
      case 'contains':
        sql = `"${field}" LIKE ?`
        params.push(`%${String(value)}%`)
        break
      case 'starts_with':
        sql = `"${field}" LIKE ?`
        params.push(`${String(value)}%`)
        break
      case 'ends_with':
        sql = `"${field}" LIKE ?`
        params.push(`%${String(value)}`)
        break
      default: {
        // Exhaustive check — TypeScript ensures all WhereOperator cases are handled above
        const _exhaustive: never = operator
        throw new Error(`Unknown operator: ${String(_exhaustive)}`)
      }
    }

    if (parts.length === 0) {
      parts.push(sql)
    } else {
      parts.push(`${connector} ${sql}`)
    }
  }

  return { sql: parts.join(' '), params }
}

function toBindingValue(value: Where['value']): BindingValue {
  if (value === null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 1 : 0
  if (Array.isArray(value)) {
    // Arrays are only used with 'in'/'not_in' — shouldn't reach here for scalar binding
    throw new Error('Array value cannot be used as scalar BindingValue')
  }
  return value
}

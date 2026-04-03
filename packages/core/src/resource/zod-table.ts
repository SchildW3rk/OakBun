import { z } from 'zod'
import type { ZodTypeAny } from 'zod'
import type { Column } from '../schema/column'
import type { SchemaMap, TableDef } from '../schema/table'

// ── columnToZod — map a single Column to its Zod type ────────────────────

function columnToZod(col: Column<unknown>): ZodTypeAny {
  let base: ZodTypeAny

  switch (col.def.type) {
    case 'INTEGER':   base = z.number().int(); break
    case 'REAL':      base = z.number(); break
    case 'TEXT':      base = z.string(); break
    case 'UUID':      base = z.string().uuid(); break
    case 'BOOLEAN':   base = z.boolean(); break
    case 'TIMESTAMP': base = z.coerce.date(); break
    case 'JSON':      base = z.unknown(); break
    case 'BLOB':      base = z.instanceof(Uint8Array); break
    default:          base = z.unknown()
  }

  if (col.def.nullable) {
    base = base.nullable()
  }

  return base
}

// ── tableToZodInsert — derive insert Zod schema from TableDef ─────────────
//
// Rules (mirror InferInsert):
//   - primaryKey + autoIncrement → excluded entirely
//   - nullable → .nullable() applied
//   - defaultValue or defaultFn present → .optional()
//   - otherwise → required

export function tableToZodInsert<T, S extends SchemaMap>(
  table: TableDef<T, S>,
): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {}

  for (const [name, col] of Object.entries(table.schema)) {
    const c = col as Column<unknown>

    // Skip auto-increment primary keys — DB assigns the value
    if (c.def.primaryKey && c.def.autoIncrement) continue

    let field = columnToZod(c)

    // Fields with defaults are optional on insert
    if (c.def.defaultValue !== undefined || c.def.defaultFn !== undefined) {
      field = field.optional()
    }

    shape[name] = field
  }

  return z.object(shape)
}

// ── tableToZodRow — full row schema (all fields required except nullable) ─

export function tableToZodRow<T, S extends SchemaMap>(
  table: TableDef<T, S>,
): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {}

  for (const [name, col] of Object.entries(table.schema)) {
    shape[name] = columnToZod(col as Column<unknown>)
  }

  return z.object(shape)
}

import type { ZodTypeAny } from 'zod'

export type JsonSchema = Record<string, unknown>

// Zod v4 check internal structure
interface ZodCheckDef {
  check: string
  value?: number
  inclusive?: boolean
  minimum?: number
  maximum?: number
  format?: string
}

interface ZodCheckInternal {
  def: ZodCheckDef
}

interface ZodCheckWithInternal {
  _zod: ZodCheckInternal
  def?: ZodCheckDef
}

/** Extract description from any Zod schema — stored as `.description` on the instance. */
function getDescription(schema: ZodTypeAny): string | undefined {
  return (schema as unknown as { description?: string }).description
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = (schema._def as unknown) as Record<string, unknown>
  const typeName = def['type'] as string | undefined

  if (typeName === 'string') {
    return withDescription(schema, zodStringToSchema(def))
  }
  if (typeName === 'number') {
    return withDescription(schema, zodNumberToSchema(def))
  }
  if (typeName === 'boolean') {
    return withDescription(schema, { type: 'boolean' })
  }
  if (typeName === 'enum') {
    const entries = def['entries'] as Record<string, string> | undefined
    const values = entries ? Object.values(entries) : []
    return withDescription(schema, { type: 'string', enum: values })
  }
  if (typeName === 'object') {
    return withDescription(schema, zodObjectToSchema(def))
  }
  if (typeName === 'array') {
    const element = def['element'] as ZodTypeAny | undefined
    const result: JsonSchema = { type: 'array' }
    if (element) result['items'] = zodToJsonSchema(element)
    return withDescription(schema, result)
  }
  if (typeName === 'optional') {
    const inner = def['innerType'] as ZodTypeAny
    // description may be on the optional wrapper itself
    const desc = getDescription(schema)
    const innerSchema = zodToJsonSchema(inner)
    return desc ? { ...innerSchema, description: desc } : innerSchema
  }
  if (typeName === 'nullable') {
    const inner = def['innerType'] as ZodTypeAny
    const desc = getDescription(schema)
    const innerSchema = zodToJsonSchema(inner)
    const innerType = innerSchema['type']
    const result: JsonSchema = typeof innerType === 'string'
      ? { ...innerSchema, type: [innerType, 'null'] }
      : innerSchema
    return desc ? { ...result, description: desc } : result
  }
  if (typeName === 'default') {
    const inner = def['innerType'] as ZodTypeAny
    const defaultValue = def['defaultValue']
    const innerSchema = zodToJsonSchema(inner)
    const desc = getDescription(schema)
    const result: JsonSchema = defaultValue !== undefined
      ? { ...innerSchema, default: defaultValue }
      : innerSchema
    return desc ? { ...result, description: desc } : result
  }
  // Unknown type — return empty schema (no crash)
  return {}
}

function withDescription(schema: ZodTypeAny, result: JsonSchema): JsonSchema {
  const desc = getDescription(schema)
  return desc ? { ...result, description: desc } : result
}

function zodStringToSchema(def: Record<string, unknown>): JsonSchema {
  const schema: JsonSchema = { type: 'string' }
  const checks = def['checks'] as ZodCheckWithInternal[] | undefined
  if (!checks) return schema
  for (const check of checks) {
    const checkDef: ZodCheckDef | undefined = check._zod?.def ?? check.def
    if (!checkDef) continue
    const kind = checkDef.check
    if (kind === 'string_format') {
      const fmt = checkDef.format
      if (fmt === 'email')    schema['format'] = 'email'
      if (fmt === 'uuid')     schema['format'] = 'uuid'
      if (fmt === 'url')      schema['format'] = 'uri'
      if (fmt === 'datetime') schema['format'] = 'date-time'
      if (fmt === 'date')     schema['format'] = 'date'
      if (fmt === 'time')     schema['format'] = 'time'
    }
    if (kind === 'min_length' && checkDef.minimum !== undefined) {
      schema['minLength'] = checkDef.minimum
    }
    if (kind === 'max_length' && checkDef.maximum !== undefined) {
      schema['maxLength'] = checkDef.maximum
    }
  }
  return schema
}

function zodNumberToSchema(def: Record<string, unknown>): JsonSchema {
  const schema: JsonSchema = { type: 'number' }
  const checks = def['checks'] as ZodCheckWithInternal[] | undefined
  if (!checks) return schema
  for (const check of checks) {
    const checkDef: ZodCheckDef | undefined = check._zod?.def ?? check.def
    if (!checkDef) continue
    const kind = checkDef.check
    if (kind === 'greater_than' && checkDef.value !== undefined) {
      if (checkDef.inclusive) {
        schema['minimum'] = checkDef.value
      } else {
        schema['exclusiveMinimum'] = checkDef.value
      }
    }
    if (kind === 'less_than' && checkDef.value !== undefined) {
      if (checkDef.inclusive) {
        schema['maximum'] = checkDef.value
      } else {
        schema['exclusiveMaximum'] = checkDef.value
      }
    }
    if (kind === 'multiple_of' && checkDef.value !== undefined) {
      schema['multipleOf'] = checkDef.value
    }
  }
  return schema
}

function zodObjectToSchema(def: Record<string, unknown>): JsonSchema {
  const shape = def['shape'] as Record<string, ZodTypeAny> | undefined
  const resolvedShape: Record<string, ZodTypeAny> = shape ?? {}

  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [key, fieldSchema] of Object.entries(resolvedShape)) {
    const fieldDef = (fieldSchema._def as unknown) as Record<string, unknown>
    const isOptional = fieldDef['type'] === 'optional'
    properties[key] = zodToJsonSchema(fieldSchema)
    if (!isOptional) {
      required.push(key)
    }
  }

  const result: JsonSchema = { type: 'object', properties }
  if (required.length > 0) {
    result['required'] = required
  }
  return result
}

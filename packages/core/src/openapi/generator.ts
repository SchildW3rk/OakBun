import type { Route } from '../app/types'
import { zodToJsonSchema } from './zod-to-schema'
import type { JsonSchema } from './zod-to-schema'
import type { ZodTypeAny } from 'zod'

export interface OpenApiSpec {
  openapi: '3.1.0'
  info: { title: string; version: string; description?: string }
  paths: Record<string, Record<string, OpenApiOperation>>
  components?: {
    securitySchemes?: Record<string, OpenApiSecurityScheme>
  }
}

interface OpenApiSecurityScheme {
  type:          'http'
  scheme:        'bearer'
  bearerFormat?: string
}

interface OpenApiOperation {
  operationId?: string
  summary?:     string
  description?: string
  tags?:        string[]
  security?:    Array<Record<string, string[]>>
  parameters?:  OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses:    Record<string, OpenApiResponse>
}

interface OpenApiParameter {
  name: string
  in: 'path' | 'query'
  required: boolean
  schema: JsonSchema
}

interface OpenApiRequestBody {
  required: true
  content: {
    'application/json': {
      schema: JsonSchema
    }
  }
}

interface OpenApiResponse {
  description: string
  content?: {
    'application/json': {
      schema: JsonSchema
    }
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function toOpenApiPath(path: string): string {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}')
}

function extractPathParams(path: string): string[] {
  const matches = path.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)
  return matches ? matches.map(m => m.slice(1)) : []
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "users" → "Users", "api-keys" → "Api Keys" */
function capitalizeTag(tag: string): string {
  return tag.split('-').map(capitalize).join(' ')
}

/**
 * Derives a human-readable summary from an HTTP method and path.
 *
 * GET    /users/        → "List users"
 * GET    /users/:id     → "Get users by id"
 * GET    /users/search  → "Search users"
 * POST   /users/        → "Create users"
 * POST   /users/export  → "Export users"
 * PATCH  /users/:id     → "Update users"
 * DELETE /users/:id     → "Delete users"
 */
function inferSummary(method: string, path: string): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return method.toLowerCase()

  const isParam = (s: string): boolean => s.startsWith(':')
  const resource = segments.find(s => !isParam(s)) ?? 'resource'
  const lastSeg  = segments[segments.length - 1] ?? ''
  const hasTrailingParam = isParam(lastSeg)
  const isLiteralVerb    = !isParam(lastSeg) && lastSeg !== resource

  if (isLiteralVerb) return `${capitalize(lastSeg)} ${resource}`

  const m = method.toUpperCase()
  if (m === 'GET') {
    if (hasTrailingParam) return `Get ${resource} by ${lastSeg.slice(1)}`
    return `List ${resource}`
  }
  if (m === 'POST')   return `Create ${resource}`
  if (m === 'PATCH')  return `Update ${resource}`
  if (m === 'PUT')    return `Update ${resource}`
  if (m === 'DELETE') return `Delete ${resource}`
  return `${m.toLowerCase()} ${resource}`
}

/**
 * Derives a camelCase operationId from an HTTP method and path.
 *
 * GET    /users/        → "listUsers"
 * GET    /users/:id     → "getUsersById"
 * GET    /users/search  → "searchUsers"
 * POST   /users/        → "createUsers"
 * PATCH  /users/:id     → "updateUsers"
 * DELETE /users/:id     → "deleteUsers"
 */
function inferOperationId(method: string, path: string): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return method.toLowerCase()

  const isParam = (s: string): boolean => s.startsWith(':')
  const resource = segments.find(s => !isParam(s)) ?? 'resource'
  const lastSeg  = segments[segments.length - 1] ?? ''
  const hasTrailingParam = isParam(lastSeg)
  const isLiteralVerb    = !isParam(lastSeg) && lastSeg !== resource

  if (isLiteralVerb) return `${lastSeg}${capitalize(resource)}`

  const m = method.toUpperCase()
  if (m === 'GET') {
    if (hasTrailingParam) return `get${capitalize(resource)}By${capitalize(lastSeg.slice(1))}`
    return `list${capitalize(resource)}`
  }
  if (m === 'POST')   return `create${capitalize(resource)}`
  if (m === 'PATCH')  return `update${capitalize(resource)}`
  if (m === 'PUT')    return `update${capitalize(resource)}`
  if (m === 'DELETE') return `delete${capitalize(resource)}`
  return `${m.toLowerCase()}${capitalize(resource)}`
}

// ── Generator ─────────────────────────────────────────────────────────────────

export function generateOpenApiSpec(
  routes: readonly Route<unknown>[],
  options?: { title?: string; version?: string; description?: string },
): OpenApiSpec {
  const title   = options?.title   ?? 'Veln API'
  const version = options?.version ?? '1.0.0'

  const info: OpenApiSpec['info'] = { title, version }
  if (options?.description) info.description = options.description

  const paths: Record<string, Record<string, OpenApiOperation>> = {}
  let needsBearerScheme = false

  for (const route of routes) {
    // Skip hidden routes and routes belonging to hidden modules
    const moduleVisibility = route._module?.visibility ?? 'public'
    const routeVisibility  = route.visibility ?? moduleVisibility
    if (routeVisibility === 'hidden') continue

    const openApiPath = toOpenApiPath(route.path)
    if (!paths[openApiPath]) paths[openApiPath] = {}

    const method = route.method.toLowerCase()
    const schema = route.schema

    // Build parameters from path params + query schema
    const parameters: OpenApiParameter[] = []

    for (const paramName of extractPathParams(route.path)) {
      let paramSchema: JsonSchema = { type: 'string' }
      if (schema?.params) {
        const paramsDef = (schema.params._def as unknown) as Record<string, unknown>
        const shape = paramsDef['shape'] as Record<string, ZodTypeAny> | undefined
        const resolvedShape: Record<string, ZodTypeAny> = shape ?? {}
        if (resolvedShape[paramName]) {
          paramSchema = zodToJsonSchema(resolvedShape[paramName] as ZodTypeAny)
        }
      }
      parameters.push({ name: paramName, in: 'path', required: true, schema: paramSchema })
    }

    if (schema?.query) {
      const queryDef = (schema.query._def as unknown) as Record<string, unknown>
      const shape = queryDef['shape'] as Record<string, ZodTypeAny> | undefined
      const resolvedShape: Record<string, ZodTypeAny> = shape ?? {}
      for (const [key, fieldSchema] of Object.entries(resolvedShape)) {
        const fieldDef = (fieldSchema._def as unknown) as Record<string, unknown>
        const isOptional = fieldDef['type'] === 'optional'
        parameters.push({
          name: key,
          in: 'query',
          required: !isOptional,
          schema: zodToJsonSchema(fieldSchema),
        })
      }
    }

    // Request body
    let requestBody: OpenApiRequestBody | undefined
    if (schema?.body) {
      requestBody = {
        required: true,
        content: { 'application/json': { schema: zodToJsonSchema(schema.body) } },
      }
    }

    // Response
    const responses: Record<string, OpenApiResponse> = {}
    if (schema?.response) {
      responses['200'] = {
        description: 'Success',
        content: { 'application/json': { schema: zodToJsonSchema(schema.response) } },
      }
    } else {
      responses['200'] = { description: 'Success' }
    }
    // Additional responses from docs.responses (e.g. 401, 404)
    if (route.docs?.responses) {
      for (const [code, doc] of Object.entries(route.docs.responses)) {
        responses[code] = { description: doc.description }
      }
    }

    // ── Summary / description / operationId — docs override > route fields > auto ──
    const effectiveSummary     = route.docs?.summary     ?? route.summary     ?? inferSummary(route.method, route.path)
    const effectiveDescription = route.docs?.description ?? route.description ?? undefined
    const effectiveOperationId = route.docs?.operationId ?? inferOperationId(route.method, route.path)

    // ── Tag — module meta tag wins; fall back to first path segment ──
    const moduleTag  = route._module?.meta?.tag
    const segmentTag = route.path.split('/').filter(Boolean)[0] ?? 'general'
    const tag        = capitalizeTag(moduleTag ?? segmentTag)

    // ── Security — jwtPlugin on module ──
    const modulePlugins = route._module?.plugins ?? []
    const hasJwt = modulePlugins.some(p => p.name === 'jwt')
    if (hasJwt) needsBearerScheme = true

    const operation: OpenApiOperation = { responses }
    operation.operationId = effectiveOperationId
    operation.summary     = effectiveSummary
    if (effectiveDescription) operation.description = effectiveDescription
    operation.tags        = [tag]
    if (hasJwt)               operation.security    = [{ bearerAuth: [] }]
    if (parameters.length > 0) operation.parameters = parameters
    if (requestBody)           operation.requestBody = requestBody

    paths[openApiPath]![method] = operation
  }

  const spec: OpenApiSpec = { openapi: '3.1.0', info, paths }
  if (needsBearerScheme) {
    spec.components = {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    }
  }
  return spec
}

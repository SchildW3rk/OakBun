// Adapter
export type { VelnAdapter, BindingValue, ExecuteResult, QueryLogEntry } from './adapter/types'
export { SQLiteAdapter }                                  from './adapter/sqlite'
export type { SQLiteConfig }                              from './adapter/sqlite'
export { PostgresAdapter }                                from './adapter/postgres'
export type { PostgresConfig }                            from './adapter/postgres'
export { MySQLAdapter }                                   from './adapter/mysql'
export type { MySQLConfig }                               from './adapter/mysql'
export { resolveAdapter }                                 from './adapter/resolve'
export type { AdapterConfig }                             from './adapter/resolve'

// Schema
export { column }                                 from './schema/column'
export type { Column, ColumnDef, SqlType }        from './schema/column'
export { defineTable, toCreateTableSql }          from './schema/table'
export type {
  SchemaMap, InferRow, InferInsert, InferUpdate, InferTable,
  TableDef, TableHookHandlers,
  TableEventMap, InferTableEvents,
  RelationMeta, RelationKind, RelationsMap,
  BelongsToRelation, HasManyRelation,
  InferRelationResult, WithRelations,
}                                                 from './schema/table'
export { defineAuditTable }                       from './schema/audit'
export type { AuditTableDef, AuditLog, AuditConfig } from './schema/audit'

// Hooks
export type { ModuleHookHandlers, HookOperation } from './hooks/types'

// Migrations
export { createMigrator, generateMigration, compareSchemas, introspectSchema, splitSqlStatements } from './db/migrations/index'
export type {
  Migrator, MigratorOptions, MigrationResult, MigrationStatus, MigrationRecord,
  SchemaDiff, TableDiff, TableModification, ColumnDef as MigrationColumnDef,
  IndexDef, ColumnModification,
  GenerateOptions, GenerateResult,
} from './db/migrations/index'

// DB
export { VelnDB, BoundVelnDB, SelectBuilder, InsertBuilder, JoinBuilder } from './db/index'
export type {
  PendingEvent, TransactionResult, QueryLog,
}                                                            from './db/index'
export type { JoinClause, SelectOptions, AggregateClause, WhereInput, WhereOp, WhereConditions, FieldCondition, SqlDialect } from './db/sql'
// EventBus interface (structural type from db layer — the class below satisfies it)
export type { EventBus as EventBusInterface }                 from './db/index'

// Events
export { InMemoryEventBus, EventBus, RequestEventQueue }      from './events/index'
export type { EventBusAdapter, EventBusOptions, EventBusErrorHandler } from './events/index'
export type { EventHandler, VelnEvents }                      from './events/index'
export { defineEventHandler, EventHandlerBuilder }            from './events/handler'
export type { EventHandlerDef, EventCallback, EventHandlerFn } from './events/handler'

// Model
export { defineModel, ModelBuilder }                          from './model/index'
export type { ModelDef, ModelInstance }                       from './model/index'

// Service
export { defineService }                                      from './service/index'
export type { ServiceDef }                                    from './service/index'

// Middleware
export { defineMiddleware, MiddlewareBuilder }                from './app/middleware'
export type { MiddlewareDef }                                 from './app/middleware'

// App
export { createApp, Veln }                                    from './app/index'
export { createSystemCtx }                                    from './app/system-ctx'
export { defineModule, ModuleBuilder }                        from './app/module'
export type { VelnModule, HookDeclaration, AuditDeclaration, ServiceDeclaration }  from './app/module'
export { loggerPlugin, dbPlugin, eventBusPlugin, createPlugin, definePlugin, PluginBuilder } from './app/plugin'
export type { DbPluginConfig, DbLogOptions, NavItem }           from './app/plugin'
export type { Plugin }                                          from './app/plugin'
export type { BaseCtx, Guard, ErrorHandler, RouteHandler, Logger, AuthPayload, LogOptions, BaseOptions, AuthUser, AuthAdapter } from './app/types'
export { ValidationError, createGuard, defineGuard, createOnRequest, createOnBeforeHandle, createOnResponse } from './app/types'
export { secureHeadersPlugin }                    from './app/secure-headers'
export type { SecureHeadersOptions, CspPreset }   from './app/secure-headers'
export { rateLimitPlugin, InMemoryStore } from './app/rate-limit'
export type { RateLimitOptions, RateLimitStore } from './app/rate-limit'
export { csrfPlugin }                from './app/csrf'
export type { CsrfOptions, CsrfPlugin } from './app/csrf'
export { scalarPlugin }              from './app/scalar'
export type { ScalarOptions }        from './app/scalar'
export { bodySizeLimitPlugin }       from './app/body-size-limit'
export type { BodySizeLimitOptions } from './app/body-size-limit'
export { corsPlugin }                from './app/cors'
export type { CorsOptions, CorsPlugin } from './app/cors'
export { requestIdPlugin }           from './app/request-id'
export type { RequestIdOptions, RequestIdCtx, RequestIdPlugin } from './app/request-id'
export { compressionPlugin }         from './app/compression'
export type { CompressionOptions }   from './app/compression'
export { healthPlugin }              from './app/health'
export type { HealthPluginOptions, HealthCheck, HealthPlugin } from './app/health'
export type { VelnWsAdapter, WsRouteShape } from './app/types'
export type { RouteSchema, RouteHandlerWithSchema, InferCtx }        from './app/types'
export type { RouteMap, RouteEntry, RouteKey }                        from './app/types'
export type { StreamController, StreamOptions, SseController }        from './app/types'
export type { OnRequestHook, OnBeforeHandleHook, OnResponseHook, OnRequestFn, OnBeforeHandleFn, OnResponseFn } from './app/types'

// Client
export { createClient }                                               from './client/index'
export { createProxyClient, createModuleClient, pathToClientKey }     from './client/index'
export type { ClientResult, InferProxyClient, ProxyClientOptions }    from './client/index'
export { createTestClient }                                           from './client/test-client'
export type { TestClientOptions }                                     from './client/test-client'
export { VelnClientError }                                            from './client/error'

// OpenAPI
export { generateOpenApiSpec }    from './openapi/generator'
export type { OpenApiSpec }       from './openapi/generator'
export { zodToJsonSchema }        from './openapi/zod-to-schema'
export type { JsonSchema }        from './openapi/zod-to-schema'

// Resource
export { defineResource, ResourceBuilder, NotFoundError, ConflictError, tableToZodInsert, tableToZodRow } from './resource/index'
export type { ResourceResult, DefaultModelMethods, ResourceOptions, ModelOverrides, ServiceOverrides, RouteConfig } from './resource/index'

// Cron
export { defineCron, resolveExpression, NoOpCronLockAdapter }  from './cron/index'
export type { CronDef, CronBuilder, CronCtx, CronBuildOptions, LogLevel, CronLockAdapter } from './cron/index'

// CLI config helpers
export { defineConfig, defineCommand } from './cli/index'
export type { VelnConfig, CommandDef, CommandOption } from './cli/index'

// Errors
export {
  VelnError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  UnprocessableError,
  TooManyRequestsError,
  InternalError,
} from './errors/index'

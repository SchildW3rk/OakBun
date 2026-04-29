---
title: "OakBun Documentation"
category: "root"
tags: ["overview", "navigation"]
related: []
---

# OakBun Documentation

OakBun is a Bun-native backend framework. Type-safe routing, a built-in SQL layer, plugin architecture — no magic, no hidden dependencies.

**Requirements:** Bun >= 1.1.0 · Single external dependency: Zod

---

## Getting Started

| File | Description |
|---|---|
| [Installation](./getting-started/01-installation.md) | Add OakBun to a project |
| [Quick Start](./getting-started/02-quick-start.md) | Minimal app in under 20 lines |
| [Project Structure](./getting-started/03-project-structure.md) | Recommended folder layout |

## Core API

| File | Description |
|---|---|
| [createApp](./core/01-create-app.md) | App factory, listen, register |
| [defineModule](./core/02-define-module.md) | Route groups with guards, plugins, hooks |
| [defineResource](./core/03-define-resource.md) | Auto-generated CRUD module |
| [definePlugin](./core/04-define-plugin.md) | Extend ctx, bundle modules |
| [defineService](./core/05-define-service.md) | Per-request service instances |
| [defineModel](./core/06-define-model.md) | DB-backed model factories |
| [defineGuard](./core/07-define-guard.md) | Route and module guards |
| [defineCron](./core/08-define-cron.md) | Scheduled jobs |
| [defineTable / column](./core/09-define-table.md) | Schema definition |

## SQL Layer

| File | Description |
|---|---|
| [Overview](./sql/01-overview.md) | dbPlugin, BoundOakBunDB, adapters |
| [SelectBuilder](./sql/02-select-builder.md) | Fluent query builder |
| [Where Operators](./sql/03-where-operators.md) | Filters, AND/OR, NULL checks |
| [Pagination](./sql/04-pagination.md) | page(), limit(), offset() |
| [Aggregation](./sql/05-aggregation.md) | count(), sum(), avg(), groupBy() |
| [Relation Loader](./sql/06-relation-loader.md) | loadRelation, loadRelationOne |
| [Raw SQL](./sql/07-raw-sql.md) | ctx.db.raw(), JoinBuilder |
| [Join Builder](./sql/08-join-builder.md) | Multi-table joins |
| [Migrations](./sql/09-migrations.md) | createMigrator, oak migrate:* |
| [Query Logging](./sql/10-query-logging.md) | Slow query log, N+1 detection |

## Plugins

| File | Description |
|---|---|
| [Plugin System](./plugins/01-plugin-system.md) | How plugins work |
| [JWT Plugin](./plugins/02-jwt-plugin.md) | @oakbun/jwt |
| [Auth Adapter](./plugins/03-auth-adapter.md) | @oakbun/auth (Better Auth) |
| [DB Plugin](./plugins/04-db-plugin.md) | dbPlugin, eventBusPlugin, loggerPlugin |
| [WebSocket Plugin](./plugins/05-ws-plugin.md) | @oakbun/ws |
| [Rate Limit Plugin](./plugins/06-rate-limit-plugin.md) | rateLimitPlugin |
| [Compression Plugin](./plugins/07-compression-plugin.md) | compressionPlugin |
| [Secure Headers Plugin](./plugins/08-secure-headers-plugin.md) | secureHeadersPlugin, corsPlugin, csrfPlugin |

## Guides

| File | Description |
|---|---|
| [Error Handling](./guides/01-error-handling.md) | Error classes, onError, validation |
| [Guards & Auth](./guides/02-guards-and-auth.md) | Per-route and per-module guards |
| [Hooks & Events](./guides/03-hooks-and-events.md) | Table hooks, EventBus, defineEventHandler |
| [Audit Logging](./guides/04-audit-logging.md) | defineAuditTable, .audit() |
| [Server-Driven Nav](./guides/05-server-driven-nav.md) | .nav() on plugins, /nav endpoint |
| [N+1 Detection](./guides/06-n1-detection.md) | Query counting, loadRelation |
| [Cron Jobs](./guides/07-cron-jobs.md) | defineCron, locking, teardown |

## API Reference

| File | Description |
|---|---|
| [ctx Reference](./api/01-ctx-reference.md) | All fields available on ctx |
| [Types Reference](./api/02-types-reference.md) | All exported types |

## CLI

| File | Description |
|---|---|
| [oak CLI](./cli/01-oak-cli.md) | migrate:*, make:*, shell |

---
title: "Installation"
category: "getting-started"
tags: ["install", "setup", "bun"]
related: ["Quick Start", "createApp"]
---

# Installation

## Requirements

- [Bun](https://bun.sh) >= 1.1.0
- TypeScript >= 5.0 (included via `bun-types`)

OakBun uses Bun-native APIs (`Bun.serve`, `bun:sqlite`, `Bun.SQL`). It does not run on Node.js.

## Core Framework

```bash
bun add oakbun zod
```

Zod is a peer dependency. OakBun uses it for request/response validation schemas.

## Optional Packages

```bash
# JWT authentication
bun add @oakbun/jwt

# Better Auth integration
bun add @oakbun/auth better-auth

# WebSocket support
bun add @oakbun/ws

# Structured logger
bun add @oakbun/logger

# Scalar API docs UI
bun add @oakbun/scalar
```

## TypeScript Configuration

Add `bun-types` to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  }
}
```

## Database Adapters

OakBun ships three adapters in the core package:

| Adapter | Import |
|---|---|
| SQLite (via `bun:sqlite`) | `oakbun/adapter/sqlite` |
| PostgreSQL (via `Bun.sql`) | `oakbun/adapter/postgres` |
| MySQL (via `Bun.sql`) | `oakbun/adapter/mysql` |

```ts
import { SQLiteAdapter }   from 'oakbun/adapter/sqlite'
import { PostgresAdapter } from 'oakbun/adapter/postgres'
import { MySQLAdapter }    from 'oakbun/adapter/mysql'
```

## See Also

- [Quick Start](./02-quick-start.md)
- [Project Structure](./03-project-structure.md)

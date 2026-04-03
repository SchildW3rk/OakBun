# OakBun

[![GitHub](https://img.shields.io/github/stars/SchildW3rk/OakBun?style=flat)](https://github.com/SchildW3rk/OakBun)
[![npm](https://img.shields.io/npm/v/oakbun)](https://www.npmjs.com/package/oakbun)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> Bun-native backend framework — No Magic, just code.

## Packages

| Package | Version | Description |
|---|---|---|
| [`oakbun`](./packages/core) | 0.1.0 | Core framework |
| [`@oakbun/jwt`](./packages/jwt) | 0.1.0 | JWT plugin |
| [`@oakbun/auth`](./packages/auth) | 0.1.0 | Better Auth adapter |
| [`@oakbun/ws`](./packages/ws) | 0.1.0 | WebSocket plugin |
| [`@oakbun/logger`](./packages/logger) | 0.1.0 | Logger plugin |
| [`@oakbun/scalar`](./packages/scalar) | 0.1.0 | OpenAPI UI |

## Requirements

- [Bun](https://bun.sh) >= 1.1.0

## Quick Start

```bash
bun add oakbun
```

```ts
import { createApp, defineModule } from 'oakbun'

const app = createApp()

app.register(
  defineModule('/hello')
    .get('/', (ctx) => ctx.json({ message: 'Hello from OakBun!' }))
    .build()
)

app.listen(3000)
```

## Development

```bash
bun install        # Dependencies installieren
bun run build      # Alle Packages bauen
bun test           # Tests ausführen
```

## Documentation

Full documentation is in [`/docs`](./docs).

| Section | Description |
|---|---|
| [Getting Started](./docs/getting-started/01-installation.md) | Installation, quick start, project structure |
| [Core API](./docs/core/01-create-app.md) | createApp, defineModule, defineTable, defineService, … |
| [SQL](./docs/sql/01-overview.md) | SelectBuilder, joins, migrations, query logging |
| [Plugins](./docs/plugins/01-plugin-system.md) | DB, JWT, Auth, WebSocket, rate limiting, … |
| [Guides](./docs/guides/01-error-handling.md) | Error handling, auth, hooks, audit logging, cron jobs |
| [API Reference](./docs/api/01-ctx-reference.md) | Ctx fields, exported types |
| [CLI](./docs/cli/01-oak-cli.md) | `oak` commands |

## Contributing

Siehe [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — [René](https://schildw3rk.dev)

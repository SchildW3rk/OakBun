# OakBun

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

## Contributing

Siehe [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — [René](https://schildw3rk.dev)

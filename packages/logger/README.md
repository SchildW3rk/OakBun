# @oakbun/logger

Structured logger plugin for the OakBun framework. Pretty-prints in TTY, outputs JSON in production.

## Installation

```bash
bun add @oakbun/logger
```

## Usage

```ts
import { createApp } from 'oakbun'
import { loggerPlugin, createLogger } from '@oakbun/logger'

const app = createApp({ adapter: db })

app.use(loggerPlugin())

// Standalone logger
const log = createLogger({ scope: 'myapp', level: 'info' })
log.info('Server started', { port: 3000 })
log.error('Something failed', { err: 'details' })
```

## License

MIT

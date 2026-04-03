# @oakbun/ws

WebSocket plugin for the OakBun framework. Uses Bun's native WebSocket support.

## Installation

```bash
bun add @oakbun/ws
```

## Usage

```ts
import { createApp, defineModule } from 'oakbun'
import { createWsAdapter } from '@oakbun/ws'
import '@oakbun/ws' // enables .ws() on defineModule()

const ws = createWsAdapter()
const app = createApp({ adapter: db })

app.registerWsAdapter(ws)

app.use(defineModule('chat')
  .ws('/ws', {
    open(ctx)          { ctx.ws.send('connected') },
    message(ctx, raw)  { ctx.ws.send(raw) },
    close(ctx)         { console.log('disconnected') },
  })
)

app.listen({ port: 3000 })
```

## License

MIT

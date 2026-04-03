# @oakbun/jwt

JWT plugin for the OakBun framework. Uses [jose](https://github.com/panva/jose) under the hood.

## Installation

```bash
bun add @oakbun/jwt
```

## Usage

```ts
import { createApp } from 'oakbun'
import { jwtPlugin } from '@oakbun/jwt'

const app = createApp({ adapter: db })

app.use(jwtPlugin({
  secret: process.env.JWT_SECRET!,
  algorithm: 'HS256',
}))

// ctx.auth is now available in all route handlers
app.use(defineModule('profile')
  .get('/', async (ctx) => ctx.json(ctx.auth.payload))
)
```

## License

MIT

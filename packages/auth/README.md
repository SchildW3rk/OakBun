# @oakbun/auth

[Better Auth](https://www.better-auth.com/) integration plugin for the OakBun framework.

## Installation

```bash
bun add @oakbun/auth better-auth
```

## Usage

```ts
import { createApp } from 'oakbun'
import { betterAuthPlugin } from '@oakbun/auth'
import { betterAuth } from 'better-auth'

const auth = betterAuth({
  database: { /* your db config */ },
  emailAndPassword: { enabled: true },
})

const app = createApp({ adapter: db })

app.use(betterAuthPlugin({ auth }))
```

## License

MIT

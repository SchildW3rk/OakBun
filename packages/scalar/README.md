# @oakbun/scalar

[Scalar](https://scalar.com/) API documentation plugin for the OakBun framework. Serves an interactive OpenAPI UI from your route definitions.

## Installation

```bash
bun add @oakbun/scalar
```

## Usage

```ts
import { createApp } from 'oakbun'
import { scalarPlugin } from '@oakbun/scalar'

const app = createApp({ adapter: db })

// ... register your modules ...

scalarPlugin(app, {
  path:    '/docs',
  title:   'My API',
  version: '1.0.0',
})

app.listen({ port: 3000 })
// Visit http://localhost:3000/docs
```

## License

MIT

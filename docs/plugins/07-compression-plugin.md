---
title: "Compression Plugin"
category: "plugins"
tags: ["compression", "gzip", "brotli", "plugin"]
related: ["Secure Headers Plugin", "Plugin System"]
---

# Compression Plugin

`compressionPlugin` compresses response bodies based on the client's `Accept-Encoding` header.

## Signature

```ts
function compressionPlugin(options?: CompressionOptions): Plugin<BaseCtx, Record<never, never>>
```

## Basic Example

```ts
import { createApp, compressionPlugin } from 'oakbun'

const app = createApp()
app.use(compressionPlugin())
```

## CompressionOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `encoding` | `'gzip' \| 'br' \| 'auto'` | `'auto'` | Compression algorithm |
| `threshold` | `number` | `1024` | Minimum response size (bytes) to compress |
| `level` | `number` | — | Compression level (algorithm-specific) |

`'auto'` selects `br` (Brotli) if supported by the client, falling back to `gzip`.

## Example with Options

```ts
app.use(compressionPlugin({
  encoding:  'gzip',
  threshold: 512,    // compress responses > 512 bytes
}))
```

## See Also

- [Plugin System](./01-plugin-system.md)
- [Secure Headers Plugin](./08-secure-headers-plugin.md)

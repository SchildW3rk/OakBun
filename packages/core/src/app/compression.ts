import type { OnResponseHook } from './types'
import { createOnResponse } from './types'

// ── Options ─────────────────────────────────────────────────────────────────

export interface CompressionOptions {
  /**
   * Compression algorithms to offer, in preference order.
   * Default: `['gzip', 'deflate']`
   *
   * Bun 1.x provides `Bun.gzipSync` and `Bun.deflateSync` natively.
   */
  encodings?: Array<'gzip' | 'deflate'>

  /**
   * Minimum response body size in bytes before compression is applied.
   * Responses smaller than this are sent uncompressed.
   * Default: `1024` (1 KB)
   */
  threshold?: number

  /**
   * Maximum response body size in bytes to attempt compression.
   * Responses larger than this are passed through uncompressed to avoid
   * excessive memory usage when buffering very large responses.
   * Default: `10485760` (10 MB)
   */
  maxSize?: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Content-types that benefit from compression. Binary formats are excluded. */
const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|ld\+json|geo\+json|atom\+xml|rss\+xml|manifest\+json))/i

function isCompressible(contentType: string | null): boolean {
  if (!contentType) return false
  return COMPRESSIBLE.test(contentType.split(';')[0]!.trim())
}

/** Pick the best encoding the client accepts from our offered list. */
function negotiateEncoding(
  acceptEncoding: string | null,
  offered: Array<'gzip' | 'deflate'>,
): 'gzip' | 'deflate' | null {
  if (!acceptEncoding) return null
  for (const enc of offered) {
    if (acceptEncoding.includes(enc)) return enc
  }
  return null
}

// Bun-native compression — typed interface to avoid `any`
interface BunCompress {
  gzipSync(data: Uint8Array): Uint8Array
  deflateSync(data: Uint8Array): Uint8Array
}

const bunCompress = Bun as unknown as BunCompress

// ── Plugin factory ───────────────────────────────────────────────────────────

/**
 * compressionPlugin — compresses responses using Bun's native gzip/deflate.
 *
 * Usage:
 *   app.onResponse(compressionPlugin())
 *   app.onResponse(compressionPlugin({ encodings: ['gzip'], threshold: 512 }))
 *
 * Compression is skipped when:
 *   - The client doesn't send Accept-Encoding with a supported algorithm
 *   - The Content-Type is binary (images, audio, video, zip, …)
 *   - The response body is below the threshold
 *   - The response already has a Content-Encoding header (e.g. pre-compressed assets)
 *   - The response is a 204 No Content or 304 Not Modified (no body)
 *   - The response is a streaming body (Content-Type: text/event-stream)
 */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024  // 10 MB

export function compressionPlugin(options: CompressionOptions = {}): OnResponseHook {
  const encodings = options.encodings ?? ['gzip', 'deflate']
  const threshold = options.threshold ?? 1024
  const maxSize   = options.maxSize   ?? DEFAULT_MAX_SIZE

  return createOnResponse(async (ctx, res) => {
    // Skip: no-body statuses
    if (res.status === 204 || res.status === 304) return

    // Skip: already encoded
    if (res.headers.get('Content-Encoding')) return

    // Skip: SSE (streaming — must not buffer)
    const contentType = res.headers.get('Content-Type')
    if (contentType?.includes('text/event-stream')) return

    // Skip: non-compressible content type
    if (!isCompressible(contentType)) return

    // Negotiate encoding
    const acceptEncoding = ctx.req.headers.get('Accept-Encoding')
    const encoding = negotiateEncoding(acceptEncoding, encodings)
    if (!encoding) return

    // Read body — skip if below threshold or empty
    const body = await res.arrayBuffer()
    if (body.byteLength < threshold) return

    // Skip: above max size threshold — avoid excessive memory usage
    if (body.byteLength > maxSize) return res

    // Compress via Bun-native sync API
    const input      = new Uint8Array(body)
    const compressed = encoding === 'gzip'
      ? bunCompress.gzipSync(input)
      : bunCompress.deflateSync(input)

    const headers = new Headers(res.headers)
    headers.set('Content-Encoding', encoding)
    headers.set('Content-Length', String(compressed.byteLength))
    headers.set('Vary', 'Accept-Encoding')

    return new Response(compressed.buffer as ArrayBuffer, { status: res.status, headers })
  })
}

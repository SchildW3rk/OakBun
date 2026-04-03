import type { OnRequestHook } from './types'
import { createOnRequest } from './types'

export interface BodySizeLimitOptions {
  /**
   * Maximum allowed body size in bytes.
   * Default: 1_048_576 (1 MB)
   */
  maxSize?: number
  /** Response message when limit is exceeded. Default: 'Payload too large' */
  message?: string
}

/**
 * bodySizeLimitPlugin — rejects requests whose Content-Length exceeds maxSize.
 *
 * Returns an OnRequestHook — pass it to app.onRequest():
 *   app.onRequest(bodySizeLimitPlugin())                      // 1MB default
 *   app.onRequest(bodySizeLimitPlugin({ maxSize: 512_000 }))  // 512KB
 *
 * Checks the Content-Length header only — does not buffer or read the body.
 * Requests without Content-Length are passed through (streaming / chunked).
 * Returns 413 Payload Too Large on violation.
 *
 * @remarks
 * This plugin enforces limits based on the Content-Length header only.
 * Chunked transfer-encoding bypasses this check entirely.
 * For production deployments, configure body size limits at the reverse proxy level:
 * nginx: `client_max_body_size`, Caddy: `request_body { max_size }`.
 */
export function bodySizeLimitPlugin(options: BodySizeLimitOptions = {}): OnRequestHook {
  const maxSize = options.maxSize ?? 1_048_576
  const message = options.message ?? 'Payload too large'

  return createOnRequest((ctx) => {
    const contentLength = ctx.req.headers.get('content-length')
    if (contentLength === null) return  // no length declared — pass through

    const bytes = parseInt(contentLength, 10)
    if (isNaN(bytes)) return  // unparseable — pass through, let handler deal with it

    if (bytes > maxSize) {
      return new Response(
        JSON.stringify({ error: 'Payload Too Large', code: 'PAYLOAD_TOO_LARGE', message }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  })
}

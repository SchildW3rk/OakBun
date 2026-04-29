import type { OakBunModule } from './module'
import type { Route, BaseCtx } from './types'
import { generateOpenApiSpec } from '../openapi/generator'

// ── Options ────────────────────────────────────────────────────────────────────

export interface ScalarOptions {
  /** Mount path for the Scalar UI. Default: '/scalar' */
  path?: string
  /** API title shown in the Scalar UI. Default: 'OakBun API' */
  title?: string
  /** API version shown in the OpenAPI spec. Default: '1.0.0' */
  version?: string
  /** Optional API description shown in the OpenAPI spec info block. Markdown supported. */
  description?: string
  /** Scalar UI theme. Default: 'purple' */
  theme?: string
  /**
   * Cache the generated OpenAPI spec after the first request.
   * Default: false — spec is regenerated on every request (safe for development).
   * Set to true in production to avoid repeated traversal of app.routes.
   */
  cache?: boolean
}

// ── App reference — minimal shape needed at runtime ───────────────────────────

interface AppRef {
  routes: Route<unknown>[]
}

// ── HTML template ──────────────────────────────────────────────────────────────

function renderHtml(specJson: string, title: string, theme: string, jsonUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body>
  <script id="api-reference" type="application/json">${specJson}</script>
  <script>
    window.__SCALAR_CONFIG__ = { theme: '${theme}' };
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`
}

// ── Plugin factory ─────────────────────────────────────────────────────────────

/**
 * scalarPlugin — mounts a Scalar API reference UI and an OpenAPI JSON endpoint.
 *
 * Usage:
 *   app.register(scalarPlugin(app))
 *   app.register(scalarPlugin(app, { path: '/docs', title: 'My API', theme: 'blue' }))
 *
 * Registers two routes (both hidden from the OpenAPI spec itself):
 *   GET {path}              → Scalar UI (HTML, CDN-loaded)
 *   GET {path}/openapi.json → Raw OpenAPI 3.1 JSON
 *
 * The app reference is captured by closure so the spec always reflects
 * the current route list at request time — including late-registered modules.
 */
export function scalarPlugin(app: AppRef, options: ScalarOptions = {}): OakBunModule {
  const mountPath   = options.path        ?? '/scalar'
  const title       = options.title       ?? 'OakBun API'
  const version     = options.version     ?? '1.0.0'
  const description = options.description ?? undefined
  const theme       = options.theme       ?? 'purple'
  const useCache    = options.cache       ?? false
  const jsonPath    = `${mountPath}/openapi.json`

  // Cache slot — null until first request when cache: true
  let cachedSpec: ReturnType<typeof generateOpenApiSpec> | null = null

  function getSpec(): ReturnType<typeof generateOpenApiSpec> {
    if (useCache) {
      if (!cachedSpec) cachedSpec = generateOpenApiSpec(app.routes, { title, version, description })
      return cachedSpec
    }
    return generateOpenApiSpec(app.routes, { title, version, description })
  }

  const jsonRoute: Route<BaseCtx> = {
    method:  'GET',
    path:    jsonPath,
    handler: {
      handler: (_ctx) => Response.json(getSpec()),
    },
    guards:     [],
    visibility: 'hidden',
  }

  const uiRoute: Route<BaseCtx> = {
    method:  'GET',
    path:    mountPath,
    handler: {
      handler: (ctx) => {
        const spec    = getSpec()
        const specJson = JSON.stringify(spec)
        const html    = renderHtml(specJson, title, theme, jsonPath)
        const res     = ctx.html(html)
        // Scalar UI requires inline scripts, cdn.jsdelivr.net, proxy.scalar.com,
        // and Google Fonts — override the strict CSP set by secureHeadersPlugin.
        res.headers.set(
          'Content-Security-Policy',
          [
            "default-src 'self'",
            "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
            "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
            "font-src *",   // Scalar bundles / loads fonts from varying CDN origins
            "connect-src 'self' https://proxy.scalar.com https://cdn.jsdelivr.net",
            "img-src 'self' data: blob: https://cdn.jsdelivr.net",
            "worker-src blob:",
          ].join('; '),
        )
        return res
      },
    },
    guards:     [],
    visibility: 'hidden',
  }

  const mod: OakBunModule = {
    prefix:              '',
    routes:              [jsonRoute, uiRoute],
    wsRoutes:            [],
    hookDeclarations:    [],
    auditDeclarations:   [],
    serviceDeclarations: [],
    plugins:             [],
    guards:              [],
    onRequestHooks:      [],
    onBeforeHandleHooks: [],
    onResponseHooks:     [],
    onError:             undefined,
    eventHandlerDefs:    [],
    cronDefs:            [],
    visibility:          'hidden',
    meta:                { tag: 'scalar', description: 'Scalar API Reference' },
  }

  return mod
}

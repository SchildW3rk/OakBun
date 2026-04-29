import type { Plugin, BaseCtx, OpenApiSpec } from 'oakbun'

// Minimal interface for what scalarPlugin needs from the app
interface AppWithDocs {
  get: (path: string, handler: (ctx: BaseCtx) => Response | Promise<Response>) => unknown
  getOpenApiSpec: (options?: { title?: string; version?: string }) => OpenApiSpec
}

export function scalarPlugin(
  app: AppWithDocs,
  options?: { path?: string; title?: string; version?: string },
): Plugin<BaseCtx, Record<never, never>> {
  const docPath = options?.path ?? '/docs'
  const title   = options?.title   ?? 'OakBun API'
  const version = options?.version ?? '1.0.0'

  // Register the docs route immediately on the app
  app.get(docPath, (_ctx) => {
    const spec = app.getOpenApiSpec({ title, version })
    const specJson = JSON.stringify(spec)
    const html = buildScalarHtml(specJson, title)
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  })

  return {
    name: 'scalar',
    request: (ctx) => ({ ...ctx }),
  }
}

function buildScalarHtml(specJson: string, title: string): string {
  // Escape for safe embedding in script tag
  const escaped = specJson.replace(/</g, '\\u003c').replace(/\//g, '\\/')
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script
    id="api-reference"
    type="application/json"
  >${escaped}</script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`
}

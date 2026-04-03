import { defineMiddleware } from 'oakbun'

export const corsMiddleware = () =>
  defineMiddleware('cors')
    .onResponse((_ctx, res) => {
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      return new Response(res.body, { status: res.status, headers })
    })
    .build()

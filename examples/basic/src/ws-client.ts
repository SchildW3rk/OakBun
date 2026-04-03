/**
 * WebSocket test client — run with: bun src/ws-client.ts
 * Connects to the running example server and exercises all WS routes.
 */

const BASE = 'ws://localhost:3000'

async function run() {
  console.log('WebSocket Test Client')
  console.log('=====================\n')

  // ── 1. Echo ───────────────────────────────────────────────────────────────
  await test('Echo (/ws/echo)', `${BASE}/ws/echo`, (ws) => {
    ws.onopen = () => ws.send('hello from client')
    ws.onmessage = (e) => {
      console.log(`  ← received: ${e.data}`)
      ws.close()
    }
  })

  // ── 2. Broadcast room ─────────────────────────────────────────────────────
  await test('Broadcast room (/ws/rooms/42)', `${BASE}/ws/rooms/42`, (ws) => {
    ws.onopen = () => {
      console.log('  ← connected to room 42')
      ws.close()
    }
  })

  // ── 3. Validated messages ─────────────────────────────────────────────────
  await test('Validated — valid payload (/ws/chat)', `${BASE}/ws/chat`, (ws) => {
    ws.onopen = () => ws.send(JSON.stringify({ text: 'hey veln', room: 'general' }))
    ws.onmessage = (e) => {
      console.log(`  ← received: ${e.data}`)
      ws.close()
    }
  })

  await test('Validated — invalid JSON (/ws/chat)', `${BASE}/ws/chat`, (ws) => {
    ws.onopen = () => ws.send('not-json{{')
    ws.onmessage = (e) => {
      const body = JSON.parse(e.data as string)
      console.log(`  ← code: ${body.code}  (expected: WS_PARSE_ERROR)`)
      ws.close()
    }
  })

  await test('Validated — wrong schema (/ws/chat)', `${BASE}/ws/chat`, (ws) => {
    ws.onopen = () => ws.send(JSON.stringify({ wrong: true }))
    ws.onmessage = (e) => {
      const body = JSON.parse(e.data as string)
      console.log(`  ← code: ${body.code}  (expected: VALIDATION_ERROR)`)
      ws.close()
    }
  })

  // ── 4. Protected WS — missing token ───────────────────────────────────────
  console.log('Protected WS (/ws/secure) — no token:')
  try {
    const res = await fetch('http://localhost:3000/ws/secure', {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    })
    console.log(`  ← HTTP ${res.status} (expected: 401 from jwtPlugin)`)
  } catch (e) {
    console.log(`  ← error: ${e}`)
  }

  console.log('\nAll tests done.')
}

function test(
  label: string,
  url: string,
  setup: (ws: WebSocket) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`${label}:`)
    const ws = new WebSocket(url)
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')) }, 3000)
    setup(ws)
    ws.onclose = () => { clearTimeout(timer); resolve() }
    ws.onerror = (e) => { clearTimeout(timer); reject(e) }
  })
}

export {}

await run()

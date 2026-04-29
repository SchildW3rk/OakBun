# Vision — OakBun Fullstack

## 1. Die Umkehrung

Bisher gedacht: LiteForge ist ein eigenständiges Fullstack-Framework, das OakBun als Backend-Appendix nutzt. Der HTTP-Layer wurde über OakBun geklebt wie bei jedem generischen Frontend-Framework.

Das war falsch. OakBun ist bereits ein vollwertiges Backend-Framework mit DB, Services, Guards, Hooks, Auth, Cron, Events, WebSockets, Streaming. Einen zweiten Framework-Stack daneben zu pflegen erzeugt Reibung, Duplikation und Feature-Lücken, ohne Gewinn.

**Neue Richtung:** OakBun ist der Fullstack-Core. LiteForge-Runtime ist der Frontend-Layer, den OakBun ausliefert. Ein Stack, nicht zwei. Alle Backend-Features stehen Server-Functions automatisch zur Verfügung — ohne Brücken, ohne Adapter.

---

## 2. Die drei Rollen

**OakBun** — Fullstack-Core. Bleibt vollwertiges Standalone-Backend-Framework für reine API-Apps. Bekommt zusätzlich einen Fullstack-Layer: Client-Bundling, Dev-Mode mit HMR, Static-Asset-Serving, RPC-Visibility für Routes, später SSR. Dieser Layer ist opt-in — pure Backend-Nutzung bleibt unverändert möglich.

**LiteForge-Runtime** — Signals-basiertes Frontend-Framework. Bleibt unverändert. Hat keine Server-Kopplung und soll keine bekommen. Wird vom OakBun-Fullstack-Layer als Client-Bundle ausgeliefert.

**LiteForge-Fullstack-Glue** — Dünne Adapter-Schicht. Beinhaltet minimal: (a) JSX-Transform-Plugin für Bun's Bundler, (b) ein Client-Runtime-Plugin (`serverPlugin<App>()` o.Ä.), das OakBun's RPC-Proxy als `'server'` in LiteForge's Context-System injiziert. Damit respektiert Fullstack-Integration LiteForge's `use()`-Design-Prinzip — Components importieren keine Singletons, alle Fähigkeiten kommen über `use()`, identisch zu `use('router')` oder `use('toast')`. Kein eigenes Framework, keine parallele Orchestrierung. Wenn diese Schicht wächst, ist etwas falsch gelaufen.

---

## 3. Die User-Erfahrung

Ein einzelner Entrypoint. Backend und Frontend teilen sich denselben `ctx`, dieselben Services, dieselben Guards.

```ts
// src/app.ts
import { createApp, defineModule, dbPlugin } from 'oakbun'
import { liteforgeFullstack } from '@liteforge/fullstack'
import { sqliteAdapter } from 'oakbun/adapter/sqlite'
import { userService } from './services/user'
import { z } from 'zod'

const greetings = defineModule('/greetings')
  .use(userService)
  .rpc('hello', {
    input: z.object({ name: z.string() }),
    handler: async (ctx, { name }) => {
      const user = await ctx.db.from('users').where({ name }).first()
      return { message: `Hi ${user?.name ?? name}` }
    },
  })
  .build()

const app = createApp()
app.plugin(dbPlugin(sqliteAdapter({ filename: 'app.db' })))
app.plugin(liteforgeFullstack({
  clientEntry: './src/client.ts',
  publicDir: './public',
}))
app.register(greetings)

app.listen(3000)
```

Client-Entrypoint folgt LiteForge's Komposition: alles wird beim Start via `.use(plugin)` eingehängt. Der RPC-Proxy ist keine Ausnahme — er kommt als Plugin rein und landet im Context unter `'server'`.

```ts
// src/client.ts
import { defineApp } from '@liteforge/runtime'
import { routerPlugin } from '@liteforge/router'
import { serverPlugin } from '@liteforge/fullstack-client'
import type { App } from './app'
import { router } from './router'
import { RootComponent } from './RootComponent'

await defineApp({ root: RootComponent, target: '#app' })
  .use(routerPlugin(router))
  .use(serverPlugin<App>())
  .mount()
```

```tsx
// src/components/Greeting.tsx
import { defineComponent } from '@liteforge/runtime'

export const Greeting = defineComponent({
  setup({ use }) {
    const server = use('server')
    return { server }
  },
  async component({ setup }) {
    const { message } = await setup.server.greetings.hello({ name: 'René' })
    return <h1>{message}</h1>
  },
})
```

Was hier zählt, sind die Konzepte, nicht die Namen:

- Server-Functions sind **OakBun-Module-Routes mit RPC-Visibility**. Sie bekommen den vollen `ctx` (DB, Services, User, Logger, Events) wie jede andere Route — keine separate Runtime, kein separater Context.
- Client importiert nur **Typen**. Der RPC-Proxy ist statisch getypt aus der App-Definition, zur Laufzeit ein dünner fetch-Wrapper.
- Components importieren **nichts vom RPC-Proxy**. Sie nutzen `use('server')` — konsistent mit `use('router')`, `use('toast')`, `use('queryClient')`. Der Fullstack-Layer registriert den Proxy als Client-Plugin, alles andere folgt LiteForge's Standard-Muster.
- Ein OakBun-Plugin (`liteforgeFullstack` oder wie auch immer benannt) installiert Bundle, HMR, Static-Serving, HTML-Shell. Kein zweiter Prozess, kein zweites Framework.

---

## 4. Die Phasen

**Phase 1 — SPA-Fullstack.** Die fünf SPA-Blocker aus dem Analyse-Report in OakBun schließen: Client-Bundle-Plugin, HMR + File-Watching, Dev-Lifecycle, Static-Asset-Serving als First-Class-API, RPC-Visibility-Marker auf Routes. `@liteforge/server` auf Glue-Package reduzieren oder entfernen. Das `examples/starter-bun`-Beispiel auf den neuen Stack migrieren — es ist der Smoke-Test.

**Phase 2 — SSR.** Die drei SSR-Blocker schließen: Component-Render-Abstraktion (`renderToReadableStream` → `ctx.stream`), Hydration-Strategie, Per-Route-Meta/Title-API. SSR ist **opt-in**. SPA-Apps bleiben SPA-Apps, müssen nichts umstellen.

Phase 2 blockt Phase 1 nicht. Beide Modi koexistieren dauerhaft — manche Projekte wollen SPA, andere SSR, manche mischen pro Route.

---

## 5. Nicht-Ziele

- **Keine Convention-over-Configuration-Schicht.** Kein File-based Routing, keine Magic-Folder. Routes werden explizit via `defineModule` deklariert. Wer Next.js-Ergonomie will, nutzt Next.js.
- **Kein implizit aktivierter RPC.** Server-Functions sind explizit als RPC markiert. Nicht jede Route ist automatisch client-erreichbar. Explicit is better than implicit, besonders bei Security-Grenzen.
- **Kein Ersatz für OakBun-Features.** Auth, DB, Guards, Services, Events sind und bleiben OakBun-native. Der Fullstack-Layer konsumiert sie, ersetzt sie nicht.
- **Keine Frontend-Framework-Alternativen.** LiteForge-Runtime ist der Frontend-Stack dieses Fullstack-Setups. Wer React will, nutzt Next.js oder Remix. Wir bauen keinen React-Adapter.
- **Keine BFF-/Edge-/Serverless-Abstraktion.** OakBun läuft auf Bun. Nicht auf Vercel-Functions, nicht auf Cloudflare-Workers. Das ist eine bewusste Fokus-Entscheidung.
- **Kein Bruch mit LiteForge's `use()`-Architektur.** Server-Functions werden wie jedes andere LiteForge-Plugin integriert — keine Sonderrolle, keine Singleton-Imports in Components, keine globalen Variablen. Der RPC-Proxy ist ein Context-Eintrag, nichts anderes.

---

## 6. Was bleibt, was verschwindet

**Unverändert:**
- `@liteforge/runtime` — Signals, Renderer, Router, Components, Control-Flow.
- Alle Frontend-Packages (`toast`, `modal`, `calendar`, `form`, `table`, `flow`, `router`, `store`, `query`, `theme`, `i18n`, `devtools`, `admin`, `tooltip`).
- `@liteforge/bun-plugin` + `@liteforge/transform` — JSX-Compile-Step, wird als Option an OakBun's Bundle-Plugin übergeben.

**Weitgehend obsolet:**
- `@liteforge/server` — die Verantwortung (Bundle, HMR, Static, RPC-Transport, HTML-Shell, Dev-Lifecycle) wandert vollständig in OakBun. Übrig bleibt höchstens ein sehr dünnes Glue-Package.

**Refactored:**
- `@liteforge/cli` — delegiert an OakBun-Fullstack oder wird durch `oakbun`-CLI ersetzt. CLI-Primat ist offen.

**Neu in OakBun:**
- Fullstack-Plugin (Bundle + HMR + Static + HTML-Shell).
- RPC-Visibility auf Module-Builder + Type-Filter im Client-Proxy.
- SSR-Plugin (Phase 2).

---

## 7. Offene Detail-Fragen (Follow-up, nicht Vision-Blocker)

Vor Phase-1-Spec zu klären:

1. Status und Zukunft von `@liteforge/client` (eigenes Package, separat von `packages/server/src/client.ts`).
2. OakBun-Core hat keinen eigenen `tests/`-Ordner — Test-Coverage-Strategie vor Fullstack-Ausbau festlegen.
3. CLI-Primat: bleibt `liteforge`-CLI User-Facing, oder übernimmt `oakbun`-CLI?
4. SSR-Fähigkeit des LiteForge-Runtime-Renderers — produziert er gegen DOM-Shim HTML, oder braucht Phase 2 einen parallelen Server-Renderer?

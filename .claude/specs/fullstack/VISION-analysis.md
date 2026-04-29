# OakBun als Fullstack-Framework — Ist-Stand und Lücken

**Prämisse (nicht im Scope dieses Dokuments):** OakBun wird Fullstack-Core. LiteForge-Runtime bleibt reines Frontend und wird von OakBun ausgeliefert. `@liteforge/server` wird weitgehend obsolet — Verantwortung wandert in OakBun. Zwei Modi: SPA (zuerst), SSR (später).

Dieses Dokument liefert **nur Ist-Stand und Lücken** — keine API-Vorschläge, keine Namensentscheidungen, keine Code-Entwürfe.

Pfad-Konvention: `packages/*` relativ zu `/Users/codingruo/Development/OakBun` bzw. `/Users/codingruo/Development/LiteForgeJs`.

---

## Sektion 1 — OakBun heute: Stärken für den Fullstack-Pivot

### 1.1 HTML-Response
- **Vorhanden.** `ctx.html(data, status?)` implementiert in `packages/core/src/app/index.ts:717` und `:1498` (Bun-native Route-Pfad). Typisiert in `packages/core/src/app/types.ts:231`. Wrapt `new Response(data, { headers: { 'Content-Type': 'text/html' } })`.
- Docs: `api/01-ctx-reference.md — Response Helpers`.
- **Robustheit:** trivial, keine dedizierten Tests nötig — reiner Response-Wrapper.
- **Lücke (aber hier als Stärke gelistet, weil Baustein vorhanden ist):** kein HTML-Template-System, kein Streaming-HTML. Text-in, Text-out.

### 1.2 Streaming & SSE
- **Vorhanden.** `ctx.stream(writer)` in `packages/core/src/app/index.ts:34-63` (TransformStream-basiert). `ctx.sse(writer)` in `:76-118` mit voll spezifiziertem SSE-Wire-Format (`event`, `data`, `id`, `retry`, `comment`).
- Controller-Interfaces dokumentiert: `api/01-ctx-reference.md — Streaming`.
- **Robustheit:** produktiv nutzbar, saubere Controller-APIs. Kein expliziter Test-Ordner in `packages/core` — core-Tests laufen vermutlich über Benchmarks/Examples; Satelliten-Packages (`jwt`, `auth`, `ws`, `logger`) haben eigene `tests/`-Ordner.
- **Relevanz Fullstack:** direkt brauchbar für SSR-Streaming (React 19 `renderToReadableStream` → `ctx.stream`).

### 1.3 WebSocket
- **Vorhanden.** `@oakbun/ws` (`packages/ws`) registriert per `app.registerWsAdapter(ws)`, patcht `ModuleBuilder.prototype.ws()` (side-effect import). Upgrade-Handling in `packages/core/src/app/index.ts:761-774`.
- Docs: `plugins/05-ws-plugin.md`, `core/01-create-app.md — WebSocket Adapter`.
- **Robustheit:** dedizierter Test in `packages/ws/tests/websocket.test.ts`.
- **Relevanz Fullstack:** direkt Basis für HMR-Channel (siehe 2.2) und Live-RPC/Subscriptions.

### 1.4 Static Asset Serving
- **Teilweise vorhanden / nicht explizit abstrahiert.** OakBun bietet keine dedizierte `app.static(dir)`-API. Statisches Serving ist aktuell nur via regulärer Route + manuellem `new Response(await Bun.file(path).bytes())`-Pattern möglich.
- `Bun.file(...)` wird in OakBun-Core nicht genutzt (nur in `packages/core/src/cli/commands/migrate/adapter.ts` und `cli/config/loader.ts` für CLI-Config-Lesen).
- **Einschätzung:** wird in Sektion 2 als Lücke gezählt. Hier gelistet, weil das Bun-native Primitive (`Bun.file`, `new Response(Bun.file(path))`) trivial verfügbar ist — nur nicht im Framework-Layer gekapselt.

### 1.5 Module-Builder mit Zod-Schemas (RPC-Type-Extraction-Basis)
- **Vorhanden und stark.** `defineModule(prefix)` → `ModuleBuilder` in `packages/core/src/app/module.ts:554`. Routen tragen Zod-Schemas (`body`, `params`, `query`, `response`) als Metadaten.
- Client-Proxy existiert: `createProxyClient(app, baseUrl)` in `packages/core/src/client/index.ts:36-130` — extrahiert RouteMap-Typen, generiert getypte Methoden. Transport: fetch + JSON.
- Docs: `core/02-define-module.md`.
- **Robustheit:** Fluent-Builder, seal-by-`.build()`, Typableitung Ende-zu-Ende.
- **Relevanz Fullstack:** die Route-Metadaten sind bereits die Type-Quelle, die ein RPC-Bridge (Client-Seite von LiteForge) konsumieren kann. Kein neuer Mechanismus nötig, nur Erreichbarkeits-Marker für „darf via RPC aufgerufen werden".

### 1.6 DB-Layer, Services, Models, Hooks (Server-Function-Context)
- **DB:** Eigenes ORM `VelnDB` (`packages/core/src/db/`), adapterbasiert (SQLite/Postgres/MySQL). Per-Request gebunden via `VelnDB.withCtx(ctx)` → `BoundVelnDB` (`db/index.ts:86-89`). Docs: `sql/01-overview.md` bis `sql/15-distinct-union.md` (15 Kapitel).
- **Services:** `defineService(key)` in `packages/core/src/service/index.ts:75`, DI-Graph via `.use(dep)`, Factory erhält aufgelöste Deps + Logger (`:145-183`). Docs: `core/05-define-service.md`.
- **Models:** `defineModel` / Schema via `defineTable`. Docs: `core/06-define-model.md`, `core/09-define-table.md`.
- **Hooks:** Tabellen-Hooks (`.hook(table, {before,after,deleted})`, `module.ts:212-214`), Lifecycle-Hooks (`onRequest`, `onBeforeHandle`, `onResponse` auf Module und App, `index.ts:643-656`). Docs: `guides/03-hooks-and-events.md`.
- **Guards:** `defineGuard`, Reihenfolge global → module → route (`index.ts:871-873`). Docs: `core/07-define-guard.md`, `guides/02-guards-and-auth.md`.
- **Relevanz Fullstack:** jeder RPC-Aufruf/jede Server-Function kann ohne zusätzlichen Mechanismus denselben `ctx` erhalten. DB, Services, Models, Hooks, Events, Logger, User — alles vorhanden.

### 1.7 Auth
- **Vorhanden.** Zwei Optionen:
  - `@oakbun/auth` — Better-Auth-Integration via `betterAuthPlugin(config, adapter)`, mit `createVelnDbAdapter` der `BoundVelnDB` an Better-Auth andockt (`packages/auth/`). Docs: `plugins/03-auth-adapter.md`.
  - `@oakbun/jwt` — JWT-Auth-Plugin. Docs: `plugins/02-jwt-plugin.md`.
- **Robustheit:** `packages/auth/tests/` enthält `adapter.test.ts`, `plugin.test.ts`, `auth-flow.test.ts`, `where.test.ts`. `packages/jwt/tests/` enthält `jwt.test.ts`, `jwt-key-caching.test.ts`.
- **Relevanz Fullstack:** `ctx.user` / Session ist in Server-Functions ohne Extra-Arbeit verfügbar.

### 1.8 Cron & Events
- **Cron:** `defineCron(name, spec)` in `packages/core/src/cron/index.ts:221`. Docs: `core/08-define-cron.md`, `guides/07-cron-jobs.md`.
- **Events:** `eventBusPlugin`, `ctx.emit(event, payload)` + per-request Event-Buffer (in `ctx` als privates Feld). Referenziert in `packages/core/src/events/`, `packages/core/src/app/plugin.ts`, `hooks/executor.ts`. Docs: `guides/03-hooks-and-events.md`.
- **Relevanz Fullstack:** Side-Effects aus RPC-Calls (E-Mail verschicken, Cache invalidieren, Subscription-Push) nutzen die bestehenden Mechanismen — keine Parallel-Infrastruktur nötig.

### 1.9 Plugin-System
- **Vorhanden und zentral.** `definePlugin`, Registration-Order enforced via `.requires([...])` (throw at startup bei fehlender Dependency). Docs: `plugins/01-plugin-system.md`. Fullstack-Features (Bundle, HMR, Static, RPC, SSR) lassen sich als Plugins andocken — das ist der natürliche Integrationspfad.

### 1.10 Zusammenfassung Stärken
OakBun hat alle **Backend-Bausteine** eines Fullstack-Frameworks. Was fehlt, ist ausschließlich die **Frontend-Delivery-Schicht** (Bundle, HMR, Static-Serving-API, SSR). Das ist eine Additions-Aufgabe, keine Umbau-Aufgabe.

---

## Sektion 2 — OakBun heute: Schwächen / Lücken für Fullstack

### 2.1 Kein Client-Bundle-Build-Step
- **Lücke:** `Bun.build()` wird in OakBun **nicht** aufgerufen. Kein Client-Entry-Konzept, kein Output-Verzeichnis, keine Bundle-Route.
- **Referenzpunkt LiteForge:** `packages/server/src/_lifecycle.ts:55-119` ruft `Bun.build(...)` mit `liteforgeBunPlugin()` (JSX-Transform aus `@liteforge/bun-plugin`), `external: ['oakbun']` für Browser-Target, `splitting: true`.
- **Minimaler Effort:** ein OakBun-Plugin `clientBundlePlugin({ entry, outDir, plugins })`, das `Bun.build` wrappt und das Ergebnis an eine Serve-Route hängt. Der JSX-Transform-Plugin (`liteforgeBunPlugin`) bleibt in LiteForge und wird als `plugins`-Option übergeben.
- **Architektur-Andock:** Plugin-System (Sektion 1.9). Passt als neues Plugin im gleichen Layer wie `dbPlugin`.

### 2.2 Kein HMR-WebSocket für Dev-Mode
- **Lücke:** Kein Dev-Reload-Channel. OakBun hat WebSocket (1.3), aber kein File-Watcher + Broadcast-Mechanismus.
- **Referenzpunkt LiteForge:** `packages/server/src/_lifecycle.ts:479-551` — eigener `Bun.serve()` auf ephemeral port, `/__liteforge_hmr__` WS-Endpoint, File-Watcher auf `watchDir` (`./src`), debounced broadcast `{type:'reload'}`. Client-Snippet injiziert in HTML (`_lifecycle.ts:448-470`).
- **Minimaler Effort:** HMR auf denselben Bun.serve-Prozess legen (kein zweiter Port), via `@oakbun/ws`-Route. File-Watcher mit `fs.watch` oder Bun's Watch-Mode. Reload-Snippet von OakBun in HTML einspeisen.
- **Architektur-Andock:** Dev-Plugin (nur im Dev-Mode aktiv), kombiniert mit Bundle-Plugin (2.1). `fullHotReload` zuerst; echtes Module-HMR ist eigenes, größeres Thema.

### 2.3 Kein typisierter RPC-Proxy-Generator
- **Teilweise vorhanden.** `createProxyClient(app, baseUrl)` (`packages/core/src/client/index.ts:36-130`) erzeugt bereits einen getypten Client über die RouteMap — das ist im Kern ein RPC-Proxy.
- **Lücke:** (a) **Visibility-Marker fehlt** — aktuell ist jede Route client-erreichbar; es gibt keinen Mechanismus, eine Route als "nur intern" oder "nur RPC" zu kennzeichnen. (b) **Kein Import-Pfad-Pattern** — aktuell muss der Client den App-Typ importieren; das geht, aber erzwingt Typ-Only-Imports und sorgfältige Trennung.
- **Referenzpunkt LiteForge:** `defineServerFn` (`packages/server/src/server-fn.ts:3-15`) + Transport `POST /api/_rpc/{module}/{fn}` mit `X-Liteforge-RPC: 1`-Header (`packages/server/src/plugin.ts:56-88`). Payload `{input}`, Antwort `{data}` | `{error, details}`.
- **Minimaler Effort:** Marker-Flag auf Route-Metadaten + Typ-Extraction-Helper, der aus `App` nur Routen mit dem Marker in den Client-Proxy-Typ aufnimmt. Transport-Shape kann JSON/fetch bleiben.
- **Architektur-Andock:** Erweiterung von `ModuleBuilder` und `createProxyClient`; keine neue Runtime-Schicht.

### 2.4 Kein Dev-Server-Lifecycle mit File-Watching
- **Lücke:** OakBun hat keinen eingebauten Dev-Mode. Aktuell wird `bun --hot run ...` als Shell-Command genutzt, was den ganzen Prozess neu startet und State verliert.
- **Referenzpunkt LiteForge:** `app.dev({port, clientEntry})` orchestriert (siehe `_lifecycle.ts:startServer` ~:294-444): Plugin-Registration, Static-Assets, RPC-Routes, Bundle-Build, HMR-Start, HTML-Rendering, Listen.
- **Minimaler Effort:** `createApp({ dev: true })` Flag oder separate `app.dev()`-Methode, die Bundle-Plugin + HMR-Plugin automatisch registriert und Watcher spannt.
- **Architektur-Andock:** Dünne Orchestrierungs-Schicht über dem Plugin-System; kein Kernel-Umbau.

### 2.5 Keine SSR-Abstraktion (Component → HTML-String)
- **Lücke:** Kein Konzept von Root-Component, Render-Hook, Hydration-Payload.
- **Bestehend nutzbar:** `ctx.stream()` / `ctx.html()` — Ausgabe-Kanäle sind da. `ctx` ist der natürliche Request-Scope für Data-Loader.
- **Minimaler Effort (Phase SSR, nicht Phase SPA):** React 19 `renderToReadableStream(<App />, {bootstrapModules})` → Pipe in `ctx.stream()`. Braucht aber: Root-Component-Referenz, Route-Datenvorladung (OakBun-Route-Match vor React-Render), serialisierbarer Initial-State.
- **Architektur-Andock:** SSR-Plugin, nachgelagert. Kein Blocker für SPA-Mode.

### 2.6 Keine Hydration-Strategie
- **Lücke:** Nicht vorhanden. Braucht Phase SSR, nicht Phase SPA.
- **Anforderung später:** Mount-Point-Konvention (heutige LiteForge: `<div id="{mountId}">`, `packages/server/src/define-document.ts:172-192`), `hydrateRoot` statt `createRoot` clientseitig, Initial-Data-Payload `<script type="application/json" id="__LF_DATA__">`.
- **Minimaler Effort:** ignoriert bis SSR-Phase.

### 2.7 Keine SEO/Meta-Verwaltung
- **Lücke:** OakBun hat kein Meta-/Title-Management. Statische Meta-Tags müssen im HTML-Template hart kodiert werden.
- **Referenzpunkt LiteForge:** `defineDocument({lang, head:{title,description,meta,links,scripts}, body:{class}})` in `packages/server/src/define-document.ts:68-70`, gerendert in `:172-192`.
- **Minimaler Effort SPA:** trivial — Dokument-Shell statisch. Dynamische Per-Route-Meta ist SSR-Thema.
- **Architektur-Andock SSR-Phase:** Route-Scoped Meta-Api, serialisiert im SSR-Render-Step.

### 2.8 Kein Static-Asset-Serving als First-Class-API
- **Lücke:** Wie in 1.4 gelistet — Bun-Primitive `Bun.file` vorhanden, aber kein Framework-Helper `app.static(publicDir)` oder ähnliches.
- **Referenzpunkt LiteForge:** `registerStaticAssets` (`_lifecycle.ts:560-631`) walkt `publicDir`, registriert pro Datei eine GET-Route, setzt Cache-Control je nach Mode, loggt Konflikte mit reservierten Routes.
- **Minimaler Effort:** sehr klein. Plugin oder Methode auf `App`, das zum Startzeitpunkt das Verzeichnis scannt und Routen registriert.

### 2.9 Keine Conventions-over-Configuration-Schicht (File-based Routing o.Ä.)
- **Lücke:** explizit nicht gelistet als Aufgabe, aber relevant zu wissen: OakBun ist explizit/imperativ. Wenn Fullstack-Experience „wie Next.js" sein soll, bräuchte es Convention-Layer. Ist aber **außerhalb der heutigen Prämisse** — nur zur Information.

### 2.10 Zusammenfassung Lücken
Fünf Lücken sind Blocker für SPA-Mode: Bundle (2.1), HMR (2.2), Dev-Lifecycle (2.4), Static-Assets (2.8), RPC-Visibility (2.3). Vier davon existieren in LiteForge-Server bereits als Code und müssen nur portiert/angepasst werden. SSR-Lücken (2.5, 2.6, 2.7) können in Phase 2 adressiert werden.

---

## Sektion 3 — LiteForge heute: Was bleibt, was migriert, was verschwindet

Scope: `/Users/codingruo/Development/LiteForgeJs/packages/*`.

### 3.1 `@liteforge/runtime` — **bleibt unverändert**
- Pure Client-Framework: Signals, Renderer, Components, Context, JSX, Control-Flow, Client-HMR-Handler.
- Exports in `packages/runtime/src/index.ts`: `defineApp` (client bootstrap), `defineComponent`, `h`, `use`/`hasContext`, `Show`/`For`/`Switch`/`Match`/`Dynamic`, `initHMR`/`getHMRHandler`, `useClickOutside`.
- **Keine Server-Imports. Keine OakBun-Kopplung. Keine Änderung erforderlich.**

### 3.2 `@liteforge/server` — **wird weitgehend obsolet**
Aktueller Bestand in `packages/server/src/`:

| Datei | Verantwortung heute | Zielzustand |
|---|---|---|
| `define-app.ts:150-233` | `defineApp()` facade → `FullstackAppBuilder` (`.plugin`, `.use`, `.serverModules`, `.mount`, `.listen`, `.dev`, `.build`) | **obsolet** — Orchestrierung wandert vollständig in OakBun. |
| `server-module.ts:34-38` | `defineServerModule(name)` → `ServerModuleBuilder.serverFn().build()` | **obsolet** — Server-Functions werden OakBun-Module mit RPC-Visibility-Marker. |
| `server-fn.ts:3-15` | `defineServerFn({input, handler})` — Phantom-Type-Carrier | **obsolet als Package-API** — Funktionalität (Input-Schema + Handler) existiert in OakBun-Routes bereits. |
| `plugin.ts:56-88` | `handleRpcRequest()` — JSON-parse, Zod-validate, execute, respond | **migriert** → OakBun-Plugin (RPC-Handler-Logik portieren, ggf. an bestehenden Route-Pipeline andocken). |
| `_lifecycle.ts:55-119` | `Bun.build()` Client-Bundle-Pipeline mit `liteforgeBunPlugin` | **migriert** → OakBun-Bundle-Plugin (Sektion 2.1). `liteforgeBunPlugin` bleibt in `@liteforge/bun-plugin` und wird als Option übergeben. |
| `_lifecycle.ts:479-551` | HMR-WS-Server + File-Watcher | **migriert** → OakBun-Dev-Plugin (Sektion 2.2). |
| `_lifecycle.ts:560-631` | `registerStaticAssets` | **migriert** → OakBun-Static-Plugin/Methode (Sektion 2.8). |
| `_lifecycle.ts:633-663` | `registerRpcRoutes` | **migriert** → zusammen mit RPC-Handler (s. plugin.ts). |
| `_lifecycle.ts:248-265` | `withClientScript` — inject `<script src="/client.js">` | **migriert** → OakBun-Bundle-Plugin (gibt Bundle-Pfad bekannt, HTML-Helper injiziert). |
| `_lifecycle.ts:294-444` | `startServer` — ruft alle obigen Schritte | **entfällt** — Orchestrierung durch OakBun-Plugin-Chain. |
| `_lifecycle.ts:123-179` | `runBuild` — Build-Step für `liteforge build` | **migriert** → OakBun-CLI-Command oder Bundle-Plugin-Build-Mode. |
| `define-document.ts:68-70, :172-192` | `defineDocument` + `renderDocument` — HTML-Shell | **migriert oder ersetzt** — HTML-Shell-Rendering gehört zu OakBun-Fullstack-Layer. API kann übernommen werden. |
| `context.ts`, `context-plugin.ts` | Server-Function-Context-Bridge | **obsolet** — Server-Functions laufen künftig in OakBun-Ctx. |
| `client.ts:23-58` | Client-RPC-Proxy (`$server.module.fn()` → `POST /api/_rpc/...`) | **ersetzt** — OakBun-`createProxyClient` oder äquivalente Ableitung. Visibility-Marker-Filter neu. |
| `_internal.ts`, `types.ts`, `plugin.ts`, `index.ts` | Glue-Code | **obsolet** mit den abhängigen Teilen. |

**Nettobilanz:** Package wird entweder komplett entfernt oder als dünne Re-Export-Façade auf OakBun-APIs reduziert.

### 3.3 `@liteforge/cli` — **bleibt, delegiert an OakBun**
Aktueller Bestand:
- `packages/cli/src/cli.ts:1-142` — Command-Dispatch.
- `commands/dev.ts:10-29` — ruft `app.dev({port, hostname?, clientEntry?})`.
- `commands/build.ts:10-21` — ruft `app.build({clientEntry, outDir?, minify?})`.
- `commands/start.ts:10-21` — ruft `app.listen({port, hostname?, clientEntry?})`.
- `entry-discovery.ts` — findet `src/app.ts` + `src/client.ts` oder per Flag.
- `load-app.ts` — dynamischer Import.

**Zielzustand:**
- CLI bleibt (User-Interface `liteforge dev/build/start`).
- Jedes Command delegiert an OakBun-Fullstack-Entrypoints statt an `FullstackAppBuilder`. Die Entry-Discovery bleibt; nur die Dispatch-Ziele ändern sich.
- Alternativ: OakBun liefert eigene CLI (`oak dev/build/start`), und `@liteforge/cli` wird zur Thin-Shell oder entfällt.

### 3.4 `@liteforge/bun-plugin` — **bleibt unverändert**
- `packages/bun-plugin/src:7-20` — JSX-Transform für `.tsx`/`.jsx` via `build.onLoad`, ruft `@liteforge/transform`.
- Wird an OakBun-Bundle-Plugin als `plugins: [liteforgeBunPlugin()]`-Option übergeben.

### 3.5 `@liteforge/transform` — **bleibt unverändert**
- Compile-Time-Optimierungen für LiteForge-JSX. Verwendet von `@liteforge/bun-plugin`.

### 3.6 `@liteforge/client` — **Status prüfen**
- Existiert als eigenes Package (`packages/client`). Vermutlich Teil des aktuellen Client-RPC-Stacks; siehe Docs `client/01-client.md`. Zu inspizieren ob Inhalt an OakBun-Proxy angedockt werden kann oder obsolet ist.

### 3.7 Alle übrigen Frontend-Packages — **bleiben unverändert**
Rein client-seitig, ohne Server-Kopplung:
- `toast`, `modal`, `calendar`, `form`, `table`, `flow`, `router`, `store`, `query`, `theme`, `i18n`, `devtools`, `admin`, `tooltip`, `vite-plugin`, `liteforge` (Umbrella).
- Referenzpunkt: das Runtime-Package (3.1) hat keine Server-Imports; alle hier aufgelisteten Packages hängen an Runtime und sind damit ebenfalls server-frei.

### 3.8 Examples
- `examples/starter/src/main.tsx` — Vite-SPA, nicht Fullstack. Bleibt oder wird gelöscht je nach Strategie.
- `examples/starter-bun/src/app.ts:22-47` — aktueller Fullstack-Entry via `defineApp().serverModules(...)`. Muss nach Migration auf OakBun-Fullstack-Pattern umgeschrieben werden; dient als Migrations-Smoke-Test.

---

## Sektion 4 — SPA vs SSR — Ausblick

### 4.1 SPA-Modus (unmittelbare Phase)
**Minimal erforderlich aus OakBun-Sicht:**
- Client-Bundle-Plugin (Lücke 2.1).
- Static-Asset-Serving (Lücke 2.8).
- HTML-Shell-Auslieferung an Root-Route (nutzt existierendes `ctx.html`, Sektion 1.1).
- RPC-Visibility-Marker + Client-Proxy-Filter (Lücke 2.3, Teil-Stand in 1.5 vorhanden).
- Dev-Lifecycle + HMR (Lücken 2.2, 2.4).

**Minimal erforderlich aus LiteForge-Sicht:**
- Runtime bleibt (3.1).
- `defineApp` (Client) bleibt in Runtime — aktuell schon separiert vom Server-`defineApp` (`packages/runtime/src/app.ts` vs `packages/server/src/define-app.ts`).
- Client-RPC-Proxy gegen OakBun-RouteMap umstellen (ersetzt `packages/server/src/client.ts`).

**Datenfluss SPA:**
1. Browser `GET /` → OakBun liefert HTML-Shell + `<script src="/client.js">`.
2. `GET /client.js` → Bundle-Plugin liefert Bun.build-Output.
3. Client-JS hydratisiert LiteForge-Runtime in Mount-Point, startet Client-Router.
4. Interaktion → Client-Proxy `POST /rpc/...` → OakBun-Route mit vollem `ctx` (DB, Services, Guards, Hooks) → JSON-Response.

### 4.2 SSR-Modus (spätere Phase)
**Zusätzlich erforderlich aus OakBun-Sicht:**
- SSR-Plugin (Lücke 2.5): Component-Render → Stream in `ctx.stream()`.
- Route-Scoped Meta-Api (Lücke 2.7): pro-Route Title/Meta/Links, serialisiert im SSR-Render.
- Initial-Data-Payload-Serialisierung: Loader-Ergebnis als JSON in HTML einbetten.

**Zusätzlich erforderlich aus LiteForge-Sicht:**
- Server-Render-Hook auf Runtime-Seite (Component → HTML-String/-Stream). Prüfen, ob Runtime-Renderer server-fähig ist oder einen separaten SSR-Renderer braucht.
- Hydration statt initial Render (`hydrateRoot`-Äquivalent, Lücke 2.6).
- Loader-API für Route-scoped Server-Data (kann als spezialisierte Server-Function realisiert werden).

**Datenfluss SSR:**
1. Browser `GET /some/route` → OakBun matcht Route → führt Loader/Server-Function aus → bekommt Data.
2. SSR-Plugin rendert Component mit Data → HTML-Stream → `ctx.stream()` direkt an Browser.
3. HTML enthält Initial-Data-Payload + Bundle-Script.
4. Client hydratisiert, übernimmt Routing und Interaktion.

### 4.3 Phasen-Reihenfolge
- **Phase 1 (jetzt):** SPA komplett. Lücken 2.1, 2.2, 2.3, 2.4, 2.8 schließen. `@liteforge/server` abbauen, CLI umstellen.
- **Phase 2 (später):** SSR. Lücken 2.5, 2.6, 2.7 schließen. Runtime-Renderer auf Server-Fähigkeit prüfen/erweitern.
- **Phase 2 ist nicht Blocker für Phase 1.** SPA-Mode kann produktiv gehen und SSR später opt-in werden, da die Architektur (Plugin-basiert, `ctx`-durchgehend) beides trägt.

---

## Offene Punkte / Klärungsbedarf
Beim Durchgehen sind folgende Fragen aufgetaucht, die vor der Implementation geklärt werden sollten:

1. **`@liteforge/client` (Package, nicht zu verwechseln mit `client.ts` in `@liteforge/server`):** existiert als eigenes Package mit Doc-Eintrag `client/01-client.md`. Inhalt wurde nicht inspiziert. Gehört das zum RPC-Stack oder ist es ein unabhängiger Browser-Runtime-Hook?
2. **OakBun-Core-Tests:** `packages/core` hat keinen eigenen `tests/`-Ordner. Satelliten-Packages (`auth`, `jwt`, `logger`, `ws`) schon. Wird Core über Examples/Benchmarks abgedeckt, oder ist Test-Coverage ein Thema vor dem Fullstack-Ausbau?
3. **CLI-Strategie:** bleibt `liteforge`-CLI primär (Delegation an OakBun), oder wird `oak`/`oakbun`-CLI primär und `liteforge`-CLI ein Wrapper?
4. **SSR-Renderer in LiteForge-Runtime:** kann der bestehende Renderer (`packages/runtime/src/...`) auf einem Node/Bun-Server gegen ein DOM-Shim HTML produzieren, oder braucht es einen parallelen SSR-Pfad? Das entscheidet, wie groß Phase 2 wird.

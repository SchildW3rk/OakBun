---
"oakbun": minor
---

feat(plugin): add .guard() to definePlugin for plugin-level guards

Plugin guards run after global guards and before module-level guards,
establishing a clean three-tier hierarchy: plugin → module → route.

```ts
export const apiPlugin = definePlugin('api')
  .modules([categoriesModule, productsModule, invoicesModule])
  .guard(requireAuth)   // applied to all routes in all modules
  .extend(() => ({}))
```

Individual modules no longer need `.plugin(jwtPlugin(...)).guard(requireAuth)`
when bundled inside a plugin that already declares the guard.

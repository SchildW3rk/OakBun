---
"oakbun": patch
"@oakbun/auth": patch
"@oakbun/jwt": patch
"@oakbun/logger": patch
"@oakbun/ws": patch
"@oakbun/scalar": patch
---

Fix d.ts generation and add error-handling callbacks

- Split tsup config in sub-packages so `dist/index.d.ts` is emitted at the correct path (was `dist/pkg/src/index.d.ts` due to cross-package `paths` resolution)
- Add `onError` callback to `EventBus`, `CronBuildOptions`, `AuditConfig` and `onInternalError` to `createApp` for silent error handling in tests
- Add `logger: { disabled: true }` to Better Auth in auth-flow tests to suppress internal password error logging

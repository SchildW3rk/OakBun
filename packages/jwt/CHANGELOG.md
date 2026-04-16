# Changelog

## 4.0.0

### Patch Changes

- Updated dependencies [15a04df]
  - oakbun@0.5.0

## 3.0.0

### Patch Changes

- Updated dependencies [d266dfe]
  - oakbun@0.4.0

## 2.0.0

### Patch Changes

- Updated dependencies [a9da1d2]
  - oakbun@0.3.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - oakbun@0.2.0

## 0.1.1

### Patch Changes

- 45d5217: Fix d.ts generation and add error-handling callbacks

  - Split tsup config in sub-packages so `dist/index.d.ts` is emitted at the correct path (was `dist/pkg/src/index.d.ts` due to cross-package `paths` resolution)
  - Add `onError` callback to `EventBus`, `CronBuildOptions`, `AuditConfig` and `onInternalError` to `createApp` for silent error handling in tests
  - Add `logger: { disabled: true }` to Better Auth in auth-flow tests to suppress internal password error logging

- Updated dependencies [45d5217]
  - oakbun@0.1.1

All notable changes to this project will be documented in this file.
See [Changesets](https://github.com/changesets/changesets) for more information.

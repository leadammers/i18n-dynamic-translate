# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Cache keys now include the namespace and parent key. Previously `title` in namespace
  `products` and `title` in namespace `legal` shared one cache entry, so the second
  lookup was served the first namespace's translation.
- `dispose()` no longer deadlocks when keys are still queued. Pending batch callbacks are
  rejected before the processing queue is awaited, because those queued promises only
  settle through those callbacks.
- Batched translation no longer starves under a steady stream of missing keys. A 500 ms
  maximum wait now caps the 50 ms debounce window, so a continuous key stream still flushes.
- A translation provider returning fewer translations than requested now raises a
  `TranslationError` instead of persisting `undefined` as a translation value.
- `translateObject()` now collects every leaf key, not only the ones whose value happens to
  be a string. Numbers, booleans, `null` and arrays are no longer silently dropped.
- `MemoryCache.clear()` no longer stops the expiry sweeper permanently. Use the new
  `dispose()` to clear entries *and* stop the timer.
- Production mode without a configured namespace now matches allow-list entries as key
  prefixes, so backends that have no namespace concept (node-i18n) can be allow-listed.
- `getConfig()` returns a deep copy of `translationProvider` and `allowedNamespaces`, so a
  caller mutating the returned object cannot reach into the live instance configuration.
- Missing-key callback failures in both backend adapters are routed through the configured
  `onError` hook instead of going straight to `console.error`.
- `FileLock` no longer grows its internal map without bound; locks are released once the
  last holder is done.

### Changed

- **Breaking:** minimum supported Node.js version raised to 22.12, the lowest LTS still
  receiving security updates — Node 20 reached end of life in April 2026. CI now runs the
  matrix on 22 and 24.
- `js-yaml` peer range raised to `^4.3.2`; earlier 4.x releases carry a quadratic-complexity
  DoS in merge-key handling.
- DeepL and LibreTranslate error messages share one sanitizer that never includes the
  request URL or body, so API keys cannot leak into logs.
- `translateKey()` / `translateObject()` document that the `context` option is DeepL-only;
  LibreTranslate has no equivalent and ignores it.

### Removed

- `getNestedValue()` from the file-handling utilities — it was unreachable and unexported.
- The unused `format` parameter of `appendTranslationToFile()`.

### Security

- Added CI vulnerability scanning (`npm audit`), static analysis (CodeQL) and secret
  scanning (gitleaks); see `SECURITY.md`.
- npm releases are published with provenance from a dedicated workflow.

## [0.1.0]

- Initial release.

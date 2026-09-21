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
- Cache keys are now built with JSON encoding rather than a `|` join. Every component is
  consumer-supplied, so a namespace containing the separator could collide with a different
  namespace and parent-key pair.
- A provider returning the requested number of translations but a malformed entry among them
  (a DeepL response of `{ translations: [{}] }`) now raises a `TranslationError` instead of
  persisting `undefined`.
- A failed batch is reported to `onError` once per affected key. It was previously reported
  once per key *and* once more for the batch as a whole.
- `keyToText` now always receives the last key segment, as documented. The missing-key path
  passed the full dotted path while the explicit APIs passed the bare key.
- The default key-to-text conversion splits digit boundaries, so `order2Status` yields
  `Order 2 Status` instead of `Order2status`.
- A DeepL response whose entry carries no `text` field (`{ translations: [{}] }`) now raises a
  `TranslationError` on the single-text path as well. It previously returned `undefined` typed as
  `string`, which reached the cache, the backend and the locale file.
- The cache is keyed on the slot a translation occupies rather than on the arguments that addressed
  it. Parent key `product.meta` with key `name` and parent key `product` with key `meta.name` write
  to one place but held two cache entries, so the two could disagree after a second write.
- The missing-key de-duplication identity is JSON-encoded too. A key containing the separator
  could collapse into a different namespace's entry — namespace `b` with key `c:d` and namespace
  `b:c` with key `d` shared one queue entry, and the second key was silently never translated.
- `MemoryCache` composes its key from locale, key and context with the same JSON encoding, so
  the injectivity guarantee holds for the built-in cache too. A context of `formal` on key
  `title` previously shared an entry with the context-free key `title:formal`.
- The publish workflow no longer offers a `workflow_dispatch` trigger. A manual run carries no
  tag, which skipped the version/tag check and could publish arbitrary branch content.

### Added

- `cache` configuration option, accepting any `TranslationCache` implementation. The exported
  interface was previously unusable: only the built-in in-memory cache could be selected.
  Supplying one enables caching irrespective of `enableCache`.

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

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version stays below 1.0.0 the public API may change in a minor release.

## [0.1.0] — unreleased

The initial release. Nothing has been published to npm yet; the date is filled in when the
version is tagged.

### Added

- `AutoTranslate` — hooks a backend's missing-key handler, translates the key through a
  provider, writes the result back into the live i18n instance and persists it. Built for
  dynamic content whose key set is not known at build time.
- Explicit APIs alongside the hook: `translateKey()` and `translateObject()`.
- Backends: **i18next** and **node-i18n**, behind a `BackendAdapter` interface.
- Translation providers: **DeepL** (with `context` and a latency/quality model choice) and
  **LibreTranslate**, behind a `TranslationService` interface. Both send a batch as a single
  request; both are covered by an end-to-end suite against a live server, LibreTranslate's
  against a self-hosted instance so it needs no credentials.
- Persistence: `FileStorageAdapter` for JSON and YAML locale files, behind a `StorageAdapter`
  interface. All three extension points are documented and implementable from outside.
- Debounced batching — missing keys are collected into one provider request, with a maximum
  wait so a continuous key stream still flushes.
- Caching with a TTL and a size cap, or any `TranslationCache` supplied through the `cache`
  option. A cache is addressed by a `TranslationIdentity` — locale, namespace, full dot path
  and provider context — so an implementation can scope and invalidate by any of them.
- `getCacheStats()` reports `{ size }`, for the built-in cache and for a custom one that
  implements the optional `getStats()`.
- A `production` mode that translates only allow-listed namespaces.
- `keyToText` for custom key-to-source-text conversion; the built-in converter handles
  camelCase, snake_case, acronyms and digit boundaries.
- Lifecycle: `dispose()` releases timers, locks and queues; `clear()` never tears down.
- Failures are routed to an `onError` hook rather than the console, and provider errors never
  carry the API key, request URL or request body.

### Security

- Keys, locales and parent keys are used as own properties only. A `__proto__` segment in a
  dot-notation key — or a locale of that name — previously wrote through `Object.prototype`,
  affecting every object in the host process, and a lookup could return an inherited member as
  though it were a translation. On the flat write path the same name was silently dropped, losing
  the translation. Such a name is now stored and read back as an ordinary own property. Found in
  review before the first release.

### Fixed

- The **node-i18n** backend never served what it translated. The adapter wrote into a `catalog`
  property it created on the instance, but an `i18n` instance has no such property — its registry
  is closed over in the constructor and `getCatalog(locale)` is the only way to it. Translations
  were persisted to the locale file and lost from the running process, so `__()` kept returning
  the key. Writes now go into the object `getCatalog` hands out. A locale node-i18n will not
  register is reported through `onError` naming the locale, and the locale file is still written,
  so the translation survives rather than being bought again on every lookup. Found by running the
  adapter against the real package; the unit mock had invented the property and the end-to-end
  test asserted only on the file.
- An empty translation was treated as no translation. "Already translated" was decided by
  truthiness, so a provider that legitimately answers `''` — LibreTranslate does, for an empty
  source text — produced a value that looked missing on every later lookup: translated again,
  written again and saved again, for the life of the process, on the consumer's provider quota.
  Cache and backend reads now distinguish an empty value from an absent one. A key whose default
  language holds `''` is likewise kept empty rather than falling through to the humanised key
  text, and is resolved without calling the provider at all.
- Reads went through the same door as writes. `getCatalog` falls back to a related locale when the
  requested one is absent, so with `fallbacks` configured a lookup answered a missing French key
  with the German translation — and `__proto__` or `constructor` as a locale resolved to
  `Object.prototype` and `Object`, returning an inherited member as a translation. Both paths now
  check that node-i18n actually holds the locale first.

### Requirements

- Node.js >= 22.12, tested on 22 and 24. CommonJS, **zero runtime dependencies**.
- Built with TypeScript 7; the shipped type declarations compile under TypeScript 5.0 and later,
  which CI checks on every change. The optional `js-yaml` load is emitted as a native
  `await import()` rather than a downlevelled `require()`, so a bundler sees it as the dynamic
  import it is.
- `i18next`, `i18n` and `js-yaml` are optional peer dependencies — install only what you use.
  `i18next >=23.0.0` is the declared range; majors 23 through 26 are driven end to end from an
  installed tarball in CI.

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version stays below 1.0.0 the public API may change in a minor release.

## [Unreleased]

## [0.1.0] - 2026-09-21

Initial release.

### Added

- `AutoTranslate` — hooks a backend's missing-key handler, translates the key through a
  provider, writes the result back into the live i18n instance and persists it. Built for
  dynamic content whose key set is not known at build time.
- Explicit APIs alongside the hook: `translateKey()` and `translateObject()`.
- Backends: **i18next** and **node-i18n**, behind a `BackendAdapter` interface.
- Translation providers: **DeepL** (with `context` and a latency/quality model choice) and
  **LibreTranslate**, behind a `TranslationService` interface.
- Persistence: `FileStorageAdapter` for JSON and YAML locale files, behind a `StorageAdapter`
  interface. All three extension points are documented and implementable from outside.
- Debounced batching — missing keys are collected into one provider request, with a maximum
  wait so a continuous key stream still flushes.
- Caching with a TTL and a size cap, or any `TranslationCache` supplied through the `cache`
  option.
- A `production` mode that translates only allow-listed namespaces.
- `keyToText` for custom key-to-source-text conversion; the built-in converter handles
  camelCase, snake_case, acronyms and digit boundaries.
- Lifecycle: `dispose()` releases timers, locks and queues; `clear()` never tears down.
- Failures are routed to an `onError` hook rather than the console, and provider errors never
  carry the API key, request URL or request body.

### Requirements

- Node.js >= 22.12, CommonJS, **zero runtime dependencies**.
- `i18next`, `i18n` and `js-yaml` are optional peer dependencies — install only what you use.

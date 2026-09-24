# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version stays below 1.0.0 the public API may change in a minor release.

## [Unreleased]

### Added

- A Codecov badge in the README, reporting `main`. The coverage job has uploaded since 0.1.1;
  the number was only ever visible inside Codecov.

## [0.1.1] — 2026-09-25

### Added

- Coverage measurement (`npm run test:coverage`) with thresholds that fail the build on a drop,
  and a CI job that uploads the report to Codecov over OIDC. `codecov.yml` keeps Codecov reporting
  rather than gating — the thresholds are the gate — except for patch coverage on a pull request.
- `tests/unit/errorFlow.test.ts` — a provider failure is now followed from the real translator out
  to `onError`: authentication, rate limit, timeout, a malformed response, a short batch and a
  non-string entry inside a well-sized one. One test asserts the API key and the request URL never
  reach the consumer's error handler.
- `tests/unit/publicApi.test.ts` — the runtime half of `src/index.ts` is asserted: every documented
  value is still exported, nothing new is, and every enum member and the string it carries is pinned,
  so a rename like this one cannot pass unremarked again.
- Unit coverage for behaviour that had none: the DeepL request contract (`formality`,
  `split_sentences`, per-call context precedence, regional target variants), cache eviction and the
  expiry sweeper's lifecycle, the core's missing-key guards and batch disposal, `describeHttpError`'s
  sanitization, and the path-traversal guard in `getLocaleFilePath`. The coverage thresholds move up
  with them, to 94% statements, 90% branches, 95% functions and 94% lines.
- `Backend.I18N_NODE`, the correctly named member for the second backend. See *Removed* and
  *Changed* for the rest of the rename.
- A `Makefile` of development shorthands — `make gate` runs what CI runs, with the provider
  credentials cleared so the e2e suites skip instead of billing the live API. `make help` lists the
  rest. Not shipped in the package.

### Removed

- **`Backend.NODE_I18N`** — use `Backend.I18N_NODE`. **This is a breaking change in a patch
  release, deliberately.** The member existed in one published version, 0.1.0, which is a day old
  and has no dependents; no deprecated alias ships, because an alias exists to protect real
  consumers and there are none — carrying the wrong name in autocomplete and in the type until
  1.0.0 would buy nothing. The old spelling now fails in whichever way it is reached: in
  TypeScript `Backend.NODE_I18N` no longer compiles, in plain JavaScript it reads as `undefined`
  and the config check rejects it with `ConfigurationError: Backend is required`, and the bare
  string `'node-i18n'` reaches the adapter factory and gets
  `ConfigurationError: Unknown backend: node-i18n`. Anyone who installed 0.1.0 in its first day
  changes one identifier; anyone pinned to 0.1.0 is unaffected. Reasoning in
  [docs/decisions/005-the-i18n-node-name.md](docs/decisions/005-the-i18n-node-name.md).

### Fixed

- A `529` from a translation provider is retried and reported as a rate limit, not as an unknown
  failure. DeepL's API maps `529` to the same "too many requests, please wait and resend" response
  as `429`, but it was in neither the retry set nor the status-message map, so a rate-limited batch
  was dropped where a backoff would have succeeded. Both halves are shared: `529` is retried and
  described as a rate limit for **every** provider, LibreTranslate included, because every provider
  that returns it means the same thing.

### Security

- A locale that resolves to the locales directory itself is rejected instead of writing a file
  beside it. The path guard allowed the resolved base to *equal* `localesPath`, and the extension
  is appended after the guard runs, so `'.'` — or an empty locale, which `translateKey` does not
  reject — turned `/locales` into `/locales.json`: a sibling of the directory, outside it. A
  library that takes the locale from a request path or an `Accept-Language` header hands that
  string straight to this function.

### Changed

- Publishing to npm authenticates over OIDC as a trusted publisher instead of a long-lived token.
  Nothing changes for consumers: the tarball still carries a provenance attestation, minted from
  the same token the registry issues to the workflow.
- Codecov comments on every pull request, including the ones that leave coverage untouched, and the
  comment carries project and patch coverage with the delta rather than only whether the new lines
  are covered. Reporting only — the gates are unchanged.
- The README says what this package replaces — the hand-editing, the round trip through a
  spreadsheet, the post-deploy script, the raw key in front of a user — before it describes what
  the alternatives do, and the limits section no longer reads as though every new key is served
  untranslated once — it says that `translateKey` and `translateObject` return the translation and
  write it back, so pre-translating dynamic content before rendering it carries the translation in
  the first response. No claim about the library changed.
- **The second backend is called `i18n-node`**, not `node-i18n`. That name belongs to an unrelated
  npm package last published in 2022; the adapter has always been written against mashpie's
  [i18n-node](https://github.com/mashpie/i18n-node), installed with `npm install i18n`, which is
  what the `i18n: ^0.15.0` peer range points at. Renamed in every document, comment and diagram, in
  the manifest's description and keywords, in the adapter class and its file, and in the error text
  and the `backend` tag on every `BackendError` the adapter throws. Code branching on those error
  *message* strings has to change; code branching on the typed `backend` field sees `'i18n-node'`.
  Recorded in [docs/decisions/005-the-i18n-node-name.md](docs/decisions/005-the-i18n-node-name.md).
- The manifest's `description` and `keywords` now name what this does differently — filling a key
  at runtime — and the providers it talks to. npm search matches both fields, and neither `deepl`
  nor `libretranslate` was listed. No code change.

## [0.1.0] — 2026-09-23

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
- The **i18next** backend could serve a non-string as a translation. The adapter returned whatever
  `t()` gave it, so an instance whose lookups answer `undefined` — a `parseMissingKeyHandler` that
  returns nothing will — had that `undefined` written into the running instance, into the locale
  file and into the value `translateKey()` resolves to. It is now read as a miss, which is what the
  adapter's `string | null` always claimed. Found in review of the empty-translation fix, which is
  what made a non-string reach the check.
- Reads went through the same door as writes. `getCatalog` falls back to a related locale when the
  requested one is absent, so with `fallbacks` configured a lookup answered a missing French key
  with the German translation — and `__proto__` or `constructor` as a locale resolved to
  `Object.prototype` and `Object`, returning an inherited member as a translation. Both paths now
  check that node-i18n actually holds the locale first.

### Changed

- `TranslationCache.has()` is now optional. The library reads presence through `get()` — a boolean
  cannot tell a cached empty translation from a miss — so a Redis- or SQLite-backed cache no longer
  has to implement a method nothing calls. Existing implementations are unaffected.

### Requirements

- Node.js >= 22.12, tested on 22 and 24. CommonJS, **zero runtime dependencies**.
- Built with TypeScript 7; the shipped type declarations compile under TypeScript 5.0 and later,
  which CI checks on every change. The optional `js-yaml` load is emitted as a native
  `await import()` rather than a downlevelled `require()`, so a bundler sees it as the dynamic
  import it is.
- `i18next`, `i18n` and `js-yaml` are optional peer dependencies — install only what you use.
  `i18next >=23.0.0` is the declared range; majors 23 through 26 are driven end to end from an
  installed tarball in CI.

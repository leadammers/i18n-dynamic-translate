# i18n-dynamic-translate — Agent Guide

Read this first, then follow the links. Do not grep the whole codebase to orient yourself; the
index below is maintained on purpose.

## What this is

A published npm library that fills in missing i18n keys at runtime: it hooks a backend's
missing-key handler, translates the key through a provider, writes the result back into the live
i18n instance and persists it. Built for dynamic content (API metadata, product attributes) where
the set of keys is not known at build time.

**Zero runtime dependencies.** CommonJS, Node >= 22.12, built with TypeScript 7. The shipped
declarations compile under TypeScript 5.0 and later, so consumers are not forced onto 7.

## Architecture

```
            host app
               │  t('products.meta.carrier')  → key missing
               ▼
        ┌──────────────┐   missing-key hook   ┌──────────────────┐
        │ BackendAdapter│◄────────────────────►│  AutoTranslate   │
        │ i18next       │   setTranslation()   │  (orchestrator)  │
        │ node-i18n     │                      └────────┬─────────┘
        └──────────────┘                                │
                                    debounced batch ────┤
                                                        ▼
                            ┌───────────────────┐  ┌──────────────┐  ┌─────────────┐
                            │ TranslationService│  │ MemoryCache  │  │StorageAdapter│
                            │ DeepL │ Libre     │  │ TTL + sweeper│  │ FileStorage  │
                            └───────────────────┘  └──────────────┘  └─────────────┘
```

Three extension points, each behind a narrow interface with a factory: `BackendAdapter`
(`src/adapters/`), `TranslationService` (`src/translators/`), `StorageAdapter` (`src/storage/`).
Adding a backend or provider means implementing the interface and registering it in that folder's
factory — not special-casing `AutoTranslate`.

| Path | Holds |
|---|---|
| `src/index.ts` | the entire public API surface — class, types/enums, error classes |
| `src/core/AutoTranslate.ts` | orchestration: batching, caching, dispatch, persistence, lifecycle |
| `src/adapters/` | i18next and node-i18n integration |
| `src/translators/` | DeepL and LibreTranslate |
| `src/storage/` | `FileStorageAdapter`, the default persistence |
| `src/types/` | shared interfaces, config types, enums |
| `src/utils/` | `cache` · `errors` · `http` · `fileHandler` · `fileLock` · `semaphore` · `keyConverter` |

## Conventions

| Topic | File |
|---|---|
| TypeScript style, module layout, naming, errors | [docs/conventions/typescript.md](docs/conventions/typescript.md) |
| Concurrency, timers, disposal, caching | [docs/conventions/concurrency.md](docs/conventions/concurrency.md) |
| Secrets, path traversal, dependency surface | [docs/conventions/security.md](docs/conventions/security.md) |
| Test layout, mocking, regression tests | [docs/conventions/testing.md](docs/conventions/testing.md) |
| Versioning and the publish pipeline | [docs/conventions/releasing.md](docs/conventions/releasing.md) |
| Branching, commits, PRs | [CONTRIBUTING.md](CONTRIBUTING.md) |

`docs/conventions/typescript.md` is the **single source of truth** for TypeScript style here and
replaces any user- or team-level TypeScript convention. Do not apply both.

## Critical rules

1. **`src/index.ts` is the public API.** Anything exported there is frozen for the rest of the
   current minor — while the version is below 1.0.0 semver allows a breaking change in a minor
   bump, and after 1.0.0 it takes a major one.
   Utilities stay internal — do not export one for convenience.
2. **`dependencies` stays empty.** Optional functionality goes behind a lazy `import()` and an
   optional peer dependency.
3. **Never let an API key, request URL or request body into an error, a log or a test fixture.**
   All HTTP error text goes through `describeHttpError()`.
4. **Library code does not own the console.** Route failures through the consumer's `onError` hook.
   There are exactly three `console.error` *call sites* — the `reportError` fallback in each adapter
   and in the core. Other matches in `utils/errors.ts` are JSDoc examples, not code.
5. **Import through the `@/` alias.** The build fails if a `require("@/` survives into `dist/`.
6. **Dispose what you create.** Timers, locks and queues are released in `dispose()`; `clear()` never
   tears down. See the concurrency conventions — most known bugs in this repo were lifecycle bugs.
7. **A cache key contains every input that changes the value** — locale, namespace, parent key, key.

## Gate before pushing

```bash
npm run format:check && npm run typecheck && npm run build && npm test
```

E2E tests self-skip without `DEEPL_API_KEY`, so this is safe to run with no credentials.

## Known state

- `docs/planning/2026-09-21_pre-release.md` — what must be true before the first npm publish:
  blockers, decisions on the frozen public surface, and what is deliberately deferred past 0.1.0.
- `TODO.md` — the architecture backlog. `core/AutoTranslate.ts` is over the size guideline and its
  breakup is the main open item.
- `CHANGELOG.md` — what shipped and what broke.
- `docs/reviews/` and `docs/superpowers/` are gitignored working notes, present only on the machine
  that produced them.

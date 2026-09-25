# i18n-dynamic-translate — Agent Guide

Read this first, then follow the links. Do not grep the whole codebase to orient yourself; the
index below is maintained on purpose.

## What this is

An npm library that fills in missing i18n keys at runtime: it hooks a backend's missing-key
handler, translates the key through a provider, writes the result back into the live i18n
instance and persists it. Built for dynamic content (API metadata, product attributes) where
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
        │ i18n-node     │                      └────────┬─────────┘
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
| `src/adapters/` | i18next and i18n-node integration |
| `src/translators/` | DeepL and LibreTranslate |
| `src/storage/` | `FileStorageAdapter`, the default persistence |
| `src/types/` | shared interfaces, config types, enums |
| `src/utils/` | `cache` · `errors` · `http` · `fileHandler` · `fileLock` · `objectPath` · `semaphore` · `keyConverter` |
| `tools/compat/` | not shipped — proves the README's TypeScript and packaging claims in CI |
| `tools/smoke/` | not shipped — installs the packed tarball and drives it end to end in CI |

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

## Decisions

[docs/decisions/](docs/decisions/README.md) holds this repo's ADRs, indexed there — settled
decisions on the frozen public surface: keys as data (`001-keys-are-data.md`), the open i18next
peer range (`002-open-peer-range.md`), the cache identity contract (`003-cache-identity.md`), the
sync-or-promise cache widening scheduled for 0.2.0 (`004-async-cache.md`), the i18n-node rename
(`005-the-i18n-node-name.md`) and why widening a public optional property still costs a consumer
an assignment (`006-widening-is-not-free.md`). Read the index before settling an architecture
question — it is cheaper than reopening one.

## Critical rules

1. **`src/index.ts` is the public API.** Anything exported there is frozen by default: changing it
   takes an ADR that says why, and the changelog entry has to say what it costs a caller. Below
   1.0.0 semver puts no compatibility promise on any bump, so the ADR — not the version number — is
   what makes a break deliberate; 0.1.1 deleted the exported enum member `Backend.NODE_I18N`
   with no alias in [005](docs/decisions/005-the-i18n-node-name.md) and 0.1.2 changes exported type
   declarations in [006](docs/decisions/006-widening-is-not-free.md), both as patches. After 1.0.0 it takes a major.
   Note that "widening" is not a synonym for "safe" — see 006. Utilities stay internal — do not
   export one for convenience.
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
7. **A cache entry is addressed by every input that changes the value** — that is the
   `TranslationIdentity`: locale, namespace, full dot path, provider context. `parentKey` is folded
   into the path first, because two calls that spell the same slot differently must share an entry.
   Compose such keys with `JSON.stringify`, never a delimiter join — see the concurrency
   conventions.

## Gate before pushing

```bash
npm run format:check && npm run typecheck && npm run build && npm test
```

`make gate` runs the same four plus CI's check that no `@/` alias survived into `dist/`, with the
provider credentials cleared so the e2e suites skip instead of billing the live API — `make help`
lists the rest of the shorthands.

E2E tests self-skip without `DEEPL_API_KEY`, so this is safe to run with no credentials.

Touching the public types, `exports`, `main`, `types` or `files` also means running
`npm run compat:types && npm run compat:package` — the same checks CI's `compat` job runs. They
need a `dist/`, so build first. See the releasing conventions for what each one proves.

## Known state

- `TODO.md` — the architecture backlog. `core/AutoTranslate.ts` is over the size guideline and its
  breakup is the main open item.
- `CHANGELOG.md` — what shipped and what broke.
- `docs/reviews/`, `docs/superpowers/` and `docs/planning/` are gitignored working notes, present
  only on the machine that produced them. A plan that has been agreed lives there while it is being
  worked; what it changed lands in `CHANGELOG.md` and in the conventions, which is what a reader of
  this repository needs.

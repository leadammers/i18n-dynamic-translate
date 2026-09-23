# TypeScript Conventions

| Layer | Choice |
|---|---|
| Framework | none — standalone library, zero runtime dependencies |
| Lang | TypeScript 7, `strict` + `noUnusedLocals` + `noUnusedParameters` + `noImplicitOverride` + `noFallthroughCasesInSwitch` + `noUncheckedIndexedAccess` |
| Styling | n/a |
| State | plain classes; no state container |
| Tests | Vitest 4 |

> **`overrides.i18next.typescript` in `package.json` is deliberate.** i18next 26 still declares its
> optional TypeScript peer as `^5 || ^6`, so `npm ci` on npm 10 (the version Node 22 ships) refuses
> to install alongside TypeScript 7. The override points it at the root compiler. Our own type-check
> against i18next's declarations passes on 7, so the range is stale rather than a real
> incompatibility — remove the override once i18next widens it.

This file is the **single source of truth** for TypeScript style in this repo. It replaces any
user- or team-level TypeScript convention; do not apply both.

---

## Module layout

```
src/
  index.ts          public surface — the ONLY file consumers import from
  core/             AutoTranslate, the orchestrator
  adapters/         BackendAdapter implementations (i18next, node-i18n) + factory
  translators/      TranslationService implementations (DeepL, LibreTranslate) + factory
  storage/          StorageAdapter implementations
  types/            shared interfaces, enums and config types
  utils/            cache, errors, http, file handling, locking, key conversion
```

- **Imports use the `@/` path alias**, never deep relative chains: `import { http } from '@/utils/http'`.
  The alias is rewritten to relative paths at build time by `tsc-alias`; CI fails the build if any
  `require("@/` survives into `dist/`.
- **`src/index.ts` exports the class, the types/enums and the error classes — nothing else.**
  Utilities (`readLocaleFile`, `setNestedValue`, `convertKeyToText`, `Semaphore`, …) are
  implementation details. Exporting one makes it public API and freezes its signature.
- Keep files under ~400 lines and to one responsibility. `core/AutoTranslate.ts` is the known
  exception and is tracked in `TODO.md`.

## Types

- Explicit annotations on all function parameters and return types — **including lambda and callback
  parameters**, even where inference works: `texts.map((text: string) => …)`,
  `allowed.some((prefix: string) => …)`. Catches refactor drift and documents intent at the call site.
- `unknown` over `any` when a type is uncertain. `catch (error: unknown)` then narrow, never
  `catch (error: any)`.
- One accepted exception: a **test** feeding deliberately invalid input to prove runtime validation
  (`createBackendAdapter(null as any)`). Production code has no such exception.
- Enums or const-asserted unions for status/discriminator fields — never bare string literals.
  This repo uses real enums (`Backend`, `TranslationProvider`, `FileFormat`, `DeepLModelType`)
  exported from `@/types`.
- Avoid non-null assertions (`value!`). Narrow with a guard instead; reach for the assertion only on a
  provable invariant, with a one-line comment saying why.
- Prefer `cast<T>(...)` over `as any` when a cast is genuinely unavoidable, and explain it.

## Control flow

- `if/else` over ternaries; early returns over nested conditions.
- No `!!value` where the context already needs a boolean. Use the value directly, or `Boolean(value)`
  to convert explicitly.
- No empty constructors — delete them.
- No business logic in string templates.
- **A translation is present or absent, never falsy.** `''` is a value a provider returns and a
  locale file holds, so presence is tested with `!== null` and never with truthiness. A truthy test
  turns an empty translation into a permanent miss: re-translated, re-written and re-saved on every
  lookup, on the consumer's provider quota. The same goes for a source text read out of the default
  language.
- **Absence is spelled `null`, and it is the boundary's job to spell it.** `!== null` at the call
  site only holds if every adapter and cache normalises a missing value to `null` before returning
  it. An adapter reads a consumer-supplied object whose declared shape is a claim, not a check, so
  it narrows what it got — `typeof value === 'string' ? value : null` — rather than passing it on.
  A call site that cannot rely on that is looking at a bug in the boundary, not a reason to widen
  the test to `!= null`.

## Naming

- **Descriptive names always** — never single letters or cryptic abbreviations, not in loops, callbacks
  or lambdas. Bad: `k`, `cb`, `t`, `e`, `v`, `tmp`, `data2`. Good: `pendingKey`, `callback`, `text`,
  `error`, `value`, `index`.
- Booleans take an `is` / `has` / `should` / `can` prefix. Functions are verbs, variables are nouns.
- No underscore prefixes on private fields — the `private` modifier already says it. The one accepted
  use of a leading underscore is an **intentionally unused parameter** required by an interface
  (`translate(text, source, target, _context)`), which is also how `noUnusedParameters` is satisfied.
- `$` suffix is reserved for RxJS Observables. This package has none, so it should never appear.

## Strings and constants

- **Single quotes**, unless the string itself contains one.
- No magic strings or numbers. Timeouts, status codes and tuning values become named module constants:
  `BATCH_DEBOUNCE_MS`, `MAX_BATCH_WAIT_MS`, `REQUEST_TIMEOUT_MS`, `DEEPL_STATUS_MESSAGES`.
- 4-space indent, 120-column lines, semicolons, ES5 trailing commas — enforced by Prettier
  (`.prettierrc`). `npm run format:check` gates CI; a formatting diff in review means Prettier was not run.

## Errors

- Throw the typed errors from `@/utils/errors` (`TranslationError`, `BackendError`, `FileSystemError`,
  `ConfigurationError`), never bare `Error`, so consumers can discriminate.
- **Never let a provider API key, request URL or request body reach an error message.** All HTTP error
  text goes through `describeHttpError()` in `@/utils/http`, which deliberately drops them. Adding a new
  provider means adding a status-message map, not a new error ladder.
- **Library code does not own the console.** Failures inside callbacks are routed through the
  consumer's `onError` hook; `console.error` appears only as the fallback inside a `reportError` helper
  when no hook is configured. There are exactly three such call sites — one per adapter and one in the
  core — and you should not add a fourth. (A grep also matches `utils/errors.ts`, where they are JSDoc
  examples showing consumers how to handle a thrown error.)

## Standards over hand-rolling

- `crypto.randomUUID()` over hand-rolled `Math.random()` ids.
- `Intl.PluralRules` / `NumberFormat` / `DateTimeFormat` over hand-rolled pluralization or date math.
- `structuredClone(value)` over `JSON.parse(JSON.stringify(value))`.
- `AbortController` / `AbortSignal` over a manual `isCancelled` boolean.
- `URL` / `URLSearchParams` over manual query-string concatenation.
- Reuse the existing primitives before writing a new one: `Semaphore` for concurrency limits,
  `FileLock` (a per-path `Semaphore(1)`) for write exclusion, `MemoryCache` for TTL caching.

## Runtime constraints

- **Zero runtime dependencies.** `dependencies` is empty and must stay empty; anything optional
  (`js-yaml`) is a lazy `import()` behind an optional peer dependency.
- Target is CommonJS on Node >= 22.12. Use only APIs available there — global `fetch` is fine, but
  nothing newer without checking.
- The package is side-effect free (`sideEffects: false`). Module top level must not do I/O, start
  timers or mutate globals.

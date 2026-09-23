# Testing Conventions

| Layer | Choice |
|---|---|
| Runner | Vitest 4 (`vitest run`) |
| Layout | `tests/unit/` (mocked, always run) · `tests/e2e/` (real provider, opt-in) |
| Aliases | `@/*` → `src/*`, `@tests/*` → `tests/*` (see `vitest.config.ts`) |
| Typecheck | `tests/tsconfig.json`, run by `npm run typecheck` and in CI |

## Layout

- `tests/unit/<subject>.test.ts` — one file per source module, named after it
  (`cache.test.ts` covers `src/utils/cache.ts`). Everything external is mocked; these run
  everywhere, including CI, with no credentials.
- `tests/unit/regressions.test.ts` — one `describe` block per review finding ID
  (`C-1 cache identity`, `C-2 dispose`, …). See *Regression tests* below.
- `tests/e2e/deepl.test.ts` — hits the real DeepL API. **Skipped automatically when
  `DEEPL_API_KEY` is unset**, which is how CI runs it. Run locally with
  `npm run test:deepl-e2e` after putting the key in `.env.dev`.
- `tests/e2e/libretranslate.test.ts` — hits a **self-hosted** LibreTranslate instance, so it
  needs no credentials, only a server. **Skipped automatically when `LIBRETRANSLATE_URL` is
  unset**, which is how CI runs it. Run locally with:

  ```bash
  docker run --rm -p 5555:5000 -e LT_LOAD_ONLY=en,de libretranslate/libretranslate
  LIBRETRANSLATE_URL=http://127.0.0.1:5555/translate npm run test:libre-e2e
  ```

  `LT_LOAD_ONLY` limits the model download to the one language pair the suite uses.
- `tests/fixtures/` — committed input locale files. The e2e suite *writes* into
  `tests/fixtures/node-i18n-locales/<locale>/`; those output directories are gitignored and
  must never be committed.

## Rules

- **A mock is a claim about someone else's contract, and it has to be checked against the
  real package.** `createMockNodeI18n` used to expose a `catalog` property and answer an
  unknown locale with a fresh `{}`. The real `i18n` has neither — the registry is closed over
  in the constructor and `getCatalog` returns the live entry or `false` — so every write the
  adapter made went into an object nothing read, and the suite was green. Model the surface
  you actually call, including its failure returns.
- **Assert on what the consumer observes.** The node-i18n e2e checked the persisted file and
  not `i18n.__()`, so a backend that never served a translation still passed. Whatever the
  library promises to update — the live instance *and* the file — is what the test reads back.
- **A provider contract is only observable against a real server.** Unit tests mock `http`,
  so they assert the payload we *believe* the API takes — a wrong belief passes. Every
  provider therefore gets an e2e suite against a live instance before it is called supported.
  LibreTranslate's array batching was found exactly this way; the mocked test had encoded the
  opposite assumption and was green.
- **Cover new behavior with a test.** A bug fix ships with a test that fails before the fix and
  passes after it — write it first and watch it go red, otherwise you have not proven it tests
  the bug.
- **Never let a unit test reach the network or the real filesystem.** Mock the translation
  service with `vi.mock('@/translators', …)` and stub `http.post` with `vi.spyOn`. A unit test
  that needs a key is an e2e test in the wrong folder.
- **Always `await instance.dispose()`** at the end of a test that constructs an `AutoTranslate`.
  It stops the cache sweeper and the batch timer; leaking them makes later tests flaky and can
  hang the run.
- Pass `onError: (): void => {}` in the config when a test *expects* failures, so the suite output
  stays readable instead of filling with stack traces.
- Explicit types on callback parameters here too — `tests/tsconfig.json` is type-checked in CI,
  so a test file is held to the same standard as `src/`. See
  [typescript.md](./typescript.md).
- Assert on observable behavior (what reached the backend, how many provider calls happened), not
  on private internals. `Reflect.get(instance, 'field')` is a last resort, used only where the
  observable effect is a timer that has no public surface.

## Regression tests

Findings from a code review become permanent tests, not just a fixed line:

1. Reproduce the bug in a failing test **before** fixing it.
2. Keep it in `tests/unit/regressions.test.ts` under a `describe` named for the finding ID, so the
   test and the review entry stay traceable to each other.
3. Add the *inverse* assertion where the fix could over-correct — e.g. C-1 checks both that two
   namespaces stay isolated **and** that a genuine repeat lookup still hits the cache.

## Timing-sensitive tests

Batching is time-based (`BATCH_DEBOUNCE_MS` 50 ms, `MAX_BATCH_WAIT_MS` 500 ms). A test that drives
it must outlast the cap it is testing, not just the debounce, and should assert through
`waitForPendingTranslations(timeout)` rather than a bare `setTimeout` race. Derive the loop count
from a named constant so the intent survives a change to the timings.

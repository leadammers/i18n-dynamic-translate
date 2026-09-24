# Testing Conventions

| Layer     | Choice                                                                    |
| --------- | ------------------------------------------------------------------------- |
| Runner    | Vitest 4 (`vitest run`)                                                   |
| Layout    | `tests/unit/` (mocked, always run) · `tests/e2e/` (real provider, opt-in) |
| Aliases   | `@/*` → `src/*`, `@tests/*` → `tests/*` (see `vitest.config.ts`)          |
| Typecheck | `tests/tsconfig.json`, run by `npm run typecheck` and in CI               |

## Layout

- `tests/unit/<subject>.test.ts` — one file per source module, named after it
  (`cache.test.ts` covers `src/utils/cache.ts`). Everything external is mocked; these run
  everywhere, including CI, with no credentials.
- `tests/unit/regressions.test.ts` — one `describe` block per review finding ID
  (`C-1 cache identity`, `C-2 dispose`, …). See _Regression tests_ below.
- `tests/unit/errorFlow.test.ts` — the path a provider failure takes out of the library: real
  translator, real `AutoTranslate`, only `http.post` stubbed. The per-module suites cover the same
  failures a layer at a time (`http.test.ts` the retries, `translators.test.ts` the
  status-to-message mapping); what is only observable end to end is that the sanitized message
  reaches `onError` intact, once per key, with the instance still usable afterwards.
- `tests/unit/publicApi.test.ts` — asserts the runtime half of `src/index.ts`, which critical
  rule 1 freezes. `tools/compat/consumer.ts` type-checks the exported _types_; this checks that
  each value is still exported and that nothing new appeared. An accidental export is the
  expensive mistake — removing it afterwards is a breaking change.
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

- `tests/fixtures/` — committed input locale files. The e2e suite _writes into those committed
  files_: `tests/fixtures/i18n-node-locales/<locale>.json` is both the input i18n-node reads and
  the file autoSave appends to. Each suite deletes its own keys again in `afterAll`, so a run that
  completes leaves the tree unchanged — but a run that dies partway leaves generated keys in a
  tracked file. Check `git status` after an aborted e2e run and restore the fixtures.

## Rules

- **A mock is a claim about someone else's contract, and it has to be checked against the
  real package.** `createMockI18nNode` used to expose a `catalog` property and answer an
  unknown locale with a fresh `{}`. The real `i18n` has neither — the registry is closed over
  in the constructor and `getCatalog` returns the live entry or `false` — so every write the
  adapter made went into an object nothing read, and the suite was green. Model the surface
  you actually call, including its failure returns.
- **Assert on what the consumer observes.** The i18n-node e2e checked the persisted file and
  not `i18n.__()`, so a backend that never served a translation still passed. Whatever the
  library promises to update — the live instance _and_ the file — is what the test reads back.
- **A provider contract is only observable against a real server.** Unit tests mock `http`,
  so they assert the payload we _believe_ the API takes — a wrong belief passes. Every
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
- Pass `onError: (): void => {}` in the config when a test _expects_ failures, so the suite output
  stays readable instead of filling with stack traces.
- Explicit types on callback parameters here too — `tests/tsconfig.json` is type-checked in CI,
  so a test file is held to the same standard as `src/`. See
  [typescript.md](./typescript.md).
- Assert on observable behavior (what reached the backend, how many provider calls happened), not
  on private internals. `Reflect.get(instance, 'field')` is a last resort, used only where the
  observable effect is a timer that has no public surface.

## Coverage

```bash
npm run test:coverage      # text table locally, plus coverage/lcov.info
```

Measured with `@vitest/coverage-v8` over `src/**` minus `src/types/**`, which is interfaces and
enums and has nothing to execute. `all: true`, so a module no test imports shows up at 0% instead
of quietly vanishing from the report.

The `thresholds` block in `vitest.config.ts` is the gate: the run **fails** below the floor, in CI
and locally alike. The floor sits a little under the current numbers — enough that deleting a
suite is caught, loose enough that one refactored branch is not. Raise it when a run lands
comfortably above; never lower it to turn a red build green.

CI runs this once, in its own `coverage` job rather than in every matrix leg, and uploads to
Codecov over OIDC — there is no upload token in the repository. The upload is allowed to fail
without failing the build; the thresholds are what protect coverage, the upload only publishes the
number.

`codecov.yml` sets what Codecov gates on, since its defaults do not fit the two-gate arrangement.
`project` compares against the base commit and is a real status, but with `threshold: 0.5%`:
bare `auto` fails on any dip at all, including the fraction of a percent a behaviour-preserving
refactor moves, which would go red on pull requests this repo's own floor passes. `patch` is a
real status too, because "the lines this change adds are tested" is not something a project-wide
floor can say. The `changes` status is off: here it fires on test ordering, not on regressions.

The same file configures the pull-request comment. It posts on every pull request, including
ones that leave coverage untouched (`require_changes: false`) and ones whose base commit has no
report yet (`require_base: false`), and its `diff` section carries the project and patch numbers
with the delta — the current state belongs on the pull request, not only in the app. Codecov
updates the existing comment rather than adding one per push.

**The two gates measure different things and neither replaces the other.** The vitest thresholds
are an absolute floor for the whole project; Codecov's statuses are relative to the base commit and
to the diff. A change can pass the floor while dropping coverage, and vice versa.

The numbers CI reports are lower than a local run, and the CI ones are the ones the thresholds are
set against. Both e2e suites call `dotenv.config({ path: '.env.dev' })`
(`tests/e2e/deepl.test.ts:31`), so a machine with a key in that file runs the DeepL e2e for real and
covers code CI never reaches — CI skips two suites where a developer with a key skips one.

## Regression tests

Findings from a code review become permanent tests, not just a fixed line:

1. Reproduce the bug in a failing test **before** fixing it.
2. Keep it in `tests/unit/regressions.test.ts` under a `describe` named for the finding ID, so the
   test and the review entry stay traceable to each other.
3. Add the _inverse_ assertion where the fix could over-correct — e.g. C-1 checks both that two
   namespaces stay isolated **and** that a genuine repeat lookup still hits the cache.

## Timing-sensitive tests

Batching is time-based (`BATCH_DEBOUNCE_MS` 50 ms, `MAX_BATCH_WAIT_MS` 500 ms). A test that drives
it must outlast the cap it is testing, not just the debounce, and should assert through
`waitForPendingTranslations(timeout)` rather than a bare `setTimeout` race. Derive the loop count
from a named constant so the intent survives a change to the timings.

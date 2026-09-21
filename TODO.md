# TODO

> Items completed since the last pass were removed on 2026-09-21 — see `CHANGELOG.md`
> for what landed.
>
> Everything below is **post-publish work**. What has to happen *before* 0.1.0 reaches npm is in
> `docs/planning/2026-09-21_pre-release.md`.

## Architecture

### Break up AutoTranslate
`AutoTranslate` handles batch collection, debouncing, translation, persistence, caching,
key-to-text conversion and adapter orchestration in one class. This makes individual
concerns hard to test or modify in isolation.

Consider extracting:
- **BatchCollector** — debounce logic and queue management
- **TranslationExecutor** — calls the translation service, handles retries
- **PersistenceManager** — writes via the storage adapter, manages file locks

`AutoTranslate` becomes a thin coordinator that wires these together.

Deferred deliberately: it is a large, behaviour-preserving refactor and belongs on its own
branch rather than mixed into the review fixes.

## Type Safety

### Enable `exactOptionalPropertyTypes`
Still off; turning it on produces ~50 errors, mostly genuine `undefined` gaps around optional
config fields. Worth doing, but as a dedicated branch.

`noUncheckedIndexedAccess` is done — enabled on `feature/cache-contract`.

## API Design

### Improve convertKeyToText robustness
Corrected on 2026-09-21: two of the three items here were already done, and the example was
wrong. A custom key-to-text function is supported through `keyToText`, and acronyms are kept
grouped — `"apiURL"` yields `"Api URL"`, not `"Api U R L"`. Digit boundaries were fixed in the
same pass (`"order2Status"` → `"Order 2 Status"`).

Both remaining items were fixed on `feature/cache-contract`: a key that already contains a space
is passed through untouched, and a single lowercase letter in front of an acronym stays attached
to it (`"iOSDevice"` → `"iOS Device"`). Nothing open here.

## Testing

### Add translator error path tests
The E2E tests cover happy paths against the real DeepL API, but error scenarios (auth
failures, rate limits, timeouts, malformed responses) are only tested at the unit level.
Consider integration-style tests that verify the full error flow from `AutoTranslate`
through the translator to the `onError` handler.

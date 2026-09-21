# TODO

> Items completed since the last pass were removed on 2026-09-21 — see `CHANGELOG.md`
> for what landed.

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

### Enable `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
Both are currently off. Turning them on produces ~50 and ~36 errors respectively — mostly
genuine `undefined` gaps around optional config fields and array indexing. Worth doing, but
as a dedicated branch.

## API Design

### Improve convertKeyToText robustness
`convertKeyToText` splits camelCase keys into words and capitalizes them. This works for
simple cases (`"shippingTime"` → `"Shipping Time"`) but produces bad results for
abbreviations (`"apiURL"` → `"Api U R L"`), acronyms, or keys that are already
human-readable sentences.

Consider:
- Allowing consumers to provide a custom key-to-text function
- Better heuristic for consecutive uppercase letters (keep them grouped)
- Passing through keys that already contain spaces

## Testing

### Add translator error path tests
The E2E tests cover happy paths against the real DeepL API, but error scenarios (auth
failures, rate limits, timeouts, malformed responses) are only tested at the unit level.
Consider integration-style tests that verify the full error flow from `AutoTranslate`
through the translator to the `onError` handler.

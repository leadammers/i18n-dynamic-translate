# TODO

> Items completed since the last pass were removed on 2026-09-21 — see `CHANGELOG.md`
> for what landed.
>
> Everything below is **post-publish work**.

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
One known rough edge, left as is: the acronym rule preserves any word containing a run of two or
more capitals, so a contrived key can now keep a lowercase first letter (`"vATRate"` → `"vAT
Rate"`, where the old code gave `"V AT Rate"`). Telling that apart from `"iOS"` needs a
dictionary, and every real-world shape checked — `apiURL`, `XMLHttpRequest`, `parseHTMLString`,
`deliveryETA`, `is2FAEnabled` — is unchanged. Supply `keyToText` if your keys look like this.

### Decide whether `TranslationCache` should allow an async implementation
`get` and `set` are synchronous, because the lookup sits between the backend reporting a miss and
the dispatch. That rules out a direct Redis or DynamoDB implementation: those need a local `Map`
as the synchronous face with the remote copy trailing it, which the README now documents. Widening
the return types to `string | null | Promise<string | null>` and awaiting at the call sites would
remove the workaround at the cost of an await in the missing-key path. Post-0.1.0 — changing it
later is a breaking change to the public surface, so it is worth a deliberate decision rather than
a drive-by.

## Testing

### Add translator error path tests
The E2E tests cover happy paths against the real DeepL API, but error scenarios (auth
failures, rate limits, timeouts, malformed responses) are only tested at the unit level.
Consider integration-style tests that verify the full error flow from `AutoTranslate`
through the translator to the `onError` handler.

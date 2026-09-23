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

### Widen `TranslationCache` to sync-or-promise — scheduled for 0.2.0
Decided in [docs/decisions/004-async-cache.md](docs/decisions/004-async-cache.md): `get` widens to
`string | null | Promise<string | null>` and `set` to `void | Promise<void>`, awaited at the call
sites; `has`, `clear` and `getStats` stay synchronous. A union rather than a promise, so every
existing synchronous implementation keeps working untouched. It breaks the reading side of
`getConfig().cache`, so it waits for the minor bump. Do it in the same release as the
`AutoTranslate` breakup above — both rewrite the same call sites.

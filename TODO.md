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

## Testing

### Cover the adapter lifecycle paths
The two backend adapters are the last cluster of untested behaviour: roughly twenty uncovered
branch outcomes, all of them lifecycle and error handling rather than translation logic. 0.1.2
closed the `i18nextAdapter` save/restore arms; the rest of the list below still stands.

- The uninitialized guards: `setTranslation` before `initialize` throws `BackendError`, while
  `getTranslation` answers `null` and `destroy` is a no-op. Three different contracts, none
  of them asserted.
- `initialize` called twice — the guard that stops the missing-key hook from being stacked.
- The missing-key callback rejecting: `reportError` routes to the consumer's `onError` when one
  is configured and falls back to `console.error` when none is. Both sides are untested, and
  this is the one place library code is allowed to touch the console.
- i18n-node only: a catalog the instance reports as `false`, and `addLocale` for an unknown
  locale.

Do this with the adapter work rather than on its own: the tests are lifecycle assertions against
the very structure that would change, so writing them first only to rewrite them is wasted.
Together they are worth roughly 5 points of branch coverage.

## Type Safety

`noUncheckedIndexedAccess` was enabled on `feature/cache-contract`, and
`exactOptionalPropertyTypes` followed in 0.1.2.

### Widen the three optional methods on exported interfaces
`TranslationCache.has`, `TranslationCache.getStats` and `StorageAdapter.saveBatch` kept method
syntax when the surrounding optional *properties* were widened in 0.1.2, so a consumer running
`exactOptionalPropertyTypes` who spells `{ get, set, has: undefined, clear }` still gets `TS2375`.
Rewriting `has?(identity): boolean` into `has?: ((identity) => boolean) | undefined` fixes that but
swaps bivariant parameter checking for contravariant, which narrows what a consumer may assign —
the opposite of what the widening rule wants. Both halves are a break, so it waits for 0.2.0, where
[ADR 004](docs/decisions/004-async-cache.md) reopens `TranslationCache` anyway. Background:
[ADR 006](docs/decisions/006-widening-is-not-free.md).

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

## Tooling

### Run the gate locally with husky hooks
The gate — `format:check`, `typecheck`, `build`, `test` — is only enforced in CI, so a commit that
fails it is discovered after a push, one CI round-trip later. Add husky with a **pre-commit** hook
for the fast half (`format:check` and `typecheck`, ideally through lint-staged so it only looks at
staged files) and a **pre-push** hook for the slow half (`build` and `test`).

Two constraints specific to this repo:
- `dependencies` must stay empty — husky and lint-staged are `devDependencies`, and `prepare`
  must not run for a consumer installing the package. `husky` is a no-op outside a git checkout,
  but the `prepare` script still needs to tolerate that.
- CI installs with `npm ci --ignore-scripts`, which skips `prepare`; the hooks are a local
  convenience and must never become the only place a check runs. CI stays the gate of record.

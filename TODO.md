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

### Rule on a second `initialize()` against an already-hooked host
Two `I18nextAdapter` instances attached to one host and destroyed **FIFO** leave the host
permanently hooked with `saveMissing: true`: the second adapter's `destroy()` restores what it saw,
which is the first adapter's handler. LIFO teardown is clean. Probed in the pre-merge review of #49.

Not fixable as a bug on its own — the fix depends on a decision the `BackendAdapter` contract does
not currently make: **is a second `initialize()` against a host another adapter has already hooked
legal at all?** If it is not, `initialize()` has to refuse it, and that is a new throwing path on a
public method. If it is, each adapter has to detect and unwind out of order, which means the hook
chain becomes part of the contract rather than an implementation detail. Either answer changes
`BackendAdapter`, so it needs an **ADR** (`docs/decisions/`) before any code, and a minor release —
not a coverage or patch pass. Phase 3 of the 0.1.2 plan ruled it out of scope for exactly this
reason and left it here.

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


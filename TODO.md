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

## Packaging and support claims

Both items below came out of asking why a freshly published package gets no traffic
(2026-09-25). Neither is a defect: each is a supported shape the package does not say it
supports, and an unstated claim reaches nobody.

### Say that ESM consumers work — next patch
`README.md`'s prerequisites name CommonJS and Node, and say nothing about ESM, so a reader on
`"type": "module"` assumes the package is unusable and leaves. It is not. `0.1.2` installed from
the registry into an ESM project resolves through Node's CJS interop, and `cjs-module-lexer`
recovers the named exports: `import pkg, { AutoTranslate, Backend, TranslationProvider }` all bind,
with every enum member intact. Verified against the **published tarball**, not against a local
`dist/`.

Saying so costs a README line, but a support claim with no gate is exactly what
`docs/conventions/releasing.md` refuses — every claim there is proven by CI. The cheap home is
`tools/smoke/`: `consumer.cjs` has no ESM sibling, and an `consumer.mjs` driven by the same
`check.mjs` would pin the import shape against the packed tarball on every run. Do the test and the
README line together or neither.

Adding an `"import"` condition to `exports` is a **separate** question and not required for this:
resolution already works without one, and adding it means shipping a real ESM build or a wrapper,
which buys the dual-package hazard. Decide that on its own merits, with an ADR, not as a side
effect of documenting what already works.

### Re-examine the `engines.node` floor — needs an ADR, so 0.2.0
`>=22.12.0` is a chosen target rather than a demonstrated requirement. `docs/conventions/typescript.md`
frames it as the target the code is written against, and the newest runtime API in the source is
global `fetch`, which lands in Node 18. Node 20 went end-of-life in April 2026, but deployments
stay on it long past that, and this floor is the single widest limit on who can install the package
at all — `npm` does enforce `engines` for anyone running `engine-strict`.

Not a manifest edit. `engines.node` is a published support claim, so lowering it means adding the
version to CI's `test` matrix and watching the suite pass there, settling the devDependency-floor
question below first (a devDependency whose own floor is higher makes the lower claim false for
contributors), and an ADR recording what the floor is *for* — otherwise the next person raises it
again. The reach argument has to outweigh that matrix cost; nobody has asked yet.

## Tooling

### Check a devDependency's own `engines.node` against ours
A devDependency can declare an `engines.node` floor above this repository's own, and npm reports it
as an install-time warning and nothing else. Neither `make gate` nor any CI job reads it, so the
first sign is a contributor on the declared minimum failing to run a tool everyone else has working.
Noticed in 0.1.2 while adding husky and lint-staged. A check belongs in the gate — walk the
installed `node_modules/*/package.json` for `engines.node` and compare each against this package's
own floor.

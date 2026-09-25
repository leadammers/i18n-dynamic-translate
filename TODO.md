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

### A Redis or S3 `StorageAdapter` — and the two contract questions it raises
`FileStorageAdapter` is the only implementation, so every deployment without a writable disk is
shut out: serverless (Vercel, Lambda — read-only except an ephemeral `/tmp`) and anything
horizontally scaled, where each instance writes its own copy. That is the widest *cannot adopt at
all* class the package has, wider than any missing backend.

Writing the adapter is the easy half. Two things have to be settled first, and neither is a Redis
or S3 detail:

- **`StorageAdapter` is write-only.** `save` and `saveBatch`, no load path
  (`src/types/index.ts:270`). Today that works because the host's own i18next backend reads the
  same directory `FileStorageAdapter` writes — `i18next-fs-backend` on `localesPath`. Point the
  writes at Redis and nothing in the pipeline reads them back, so the adapter is only useful paired
  with a matching i18next backend the consumer supplies. Giving the interface a read side is the
  alternative, and it is a change to a frozen public interface: ADR first.
- **The persistence model is read-modify-write over a whole namespace document**, serialised by an
  in-process `FileLock` (`src/storage/FileStorageAdapter.ts:17,39`). That lock is process-local, so
  it is already only correct for a single process. Redis can do this properly — atomic ops, `WATCH`,
  or a Lua script. **S3 cannot**: it has no read-modify-write, so two concurrent writers silently
  lose keys unless the adapter uses conditional writes or stores one object per key, which is a
  different shape from what the interface implies. Decide whether the contract *requires*
  atomicity or merely assumes it, and say so in `docs/conventions/concurrency.md`.

Both clients are third-party (`ioredis` or `redis`, `@aws-sdk/client-s3`), so critical rule 2
applies: `dependencies` stays empty, each goes behind a lazy `import()` and an **optional peer
dependency**, the way the optional backends already do. Redis first — it answers the atomicity
question cleanly and covers the serverless case; S3 second, once the conditional-write shape is
settled.

### An LLM `TranslationService`
The premise of this package is *dynamic* keys — `products.meta.carrier` — and `convertKeyToText`
currently hands a machine translator a decontextualised phrase. An LLM provider takes the `context`
string the contract already carries (`src/types/index.ts:161`, and both existing providers already
accept it), so it can be told that a string is a UI label in an e-commerce carrier field rather
than guessing. That is the one quality gap no MT provider can close, and it is the difference
against the several `i18n-auto-translate` packages that currently outrank this one in npm search.

Cheap on the axis that usually blocks things here: the API is plain HTTPS over global `fetch`, the
same shape as `src/translators/deepl.ts`, so **no dependency and no optional peer** — unlike a
storage adapter. Adding the enum member and the factory branch (`src/translators/index.ts:15`) is
additive and safe.

What actually needs deciding, none of it about the HTTP call:

- **The response is prose, not a string.** MT returns the translation; a model can return it
  wrapped in explanation, quoted, or refuse outright. The provider has to constrain the output and
  validate it before it reaches the cache, or a malformed answer is persisted into a locale file
  as if it were a translation.
- **Batch identity.** `translateBatch` must return exactly N entries in input order. DeepL
  guarantees that; a model does not. The failure modes are already modelled — `tests/unit/errorFlow.test.ts`
  covers a short batch and a non-string entry — so this is about making the provider detect and
  fail rather than about inventing new error paths.
- **Placeholders must survive.** i18next `{{name}}` and ICU `{count}` have to come back intact.
  This is the actual quality claim, so it is the thing to test, not an afterthought.
- **Rule 3 gets sharper.** The request body now contains the key text and the context. Nothing of
  it may reach an error, a log or a fixture; everything keeps going through `describeHttpError()`.
- Model id and system prompt are configuration, not magic strings in the provider.

Cost and latency are an order of magnitude off MT, which feeds back into how the debounced batch is
sized — worth a line in the docs rather than a code change.

### Decide whether `next-intl` can be a `BackendAdapter` at all
Next.js server rendering is the largest audience the two current backends do not reach, and
`next-intl` is where that ecosystem has settled. But it does **not** fit `BackendAdapter` as
specified, and writing the adapter is not the task — deciding the shape is.

`BackendAdapter` assumes a mutable live instance: hook the missing-key callback, translate, call
`setTranslation()`, the host serves the new value. `next-intl` has no such instance. Messages are
request-scoped, built once per request by `getRequestConfig` and passed down through
`NextIntlClientProvider`. Its two hooks are `onError` (fires with `MISSING_MESSAGE`) and
`getMessageFallback` (returns the fallback string) — **both synchronous**, so neither can await a
translation, and there is no `addResource` equivalent to write into. Verified against the
`next-intl` configuration documentation on 2026-09-25.

The integration that does fit splits across the two halves the framework already has:
`onError` enqueues the miss into the existing debounced batch, fire-and-forget; `getRequestConfig`
reads the catalog the storage adapter has since filled, so the *next* request serves the
translation. That is not `setTranslation()` into a live host, so the options are to widen
`BackendAdapter` to describe a write-behind backend, or to ship this as a documented recipe plus a
small helper rather than as an adapter. Either way it changes or sidesteps a frozen public
interface, so it needs an **ADR** before code.

It pairs with the Redis/S3 adapter above: Next.js users are disproportionately on serverless, where
the filesystem store does not work either. Neither item is worth much to that audience without the
other.

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

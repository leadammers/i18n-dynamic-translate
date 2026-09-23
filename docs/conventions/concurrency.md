# Concurrency and Resource Lifecycle

This library runs timers, holds file locks and keeps in-flight promises on behalf of a host
application it does not control. Almost every bug found in the 2026-09-21 review lived here. These
rules are the ones that would have prevented them.

## Every resource has an owner and a teardown

- Anything that schedules work — `setTimeout`, `setInterval`, a queue, a lock — is owned by the
  object that created it and must be released in that object's teardown method.
- **`clear()` and `dispose()` are different verbs.** `clear()` empties state and the object stays
  usable; `dispose()` releases resources and the object is finished. Never fold one into the other:
  `MemoryCache.clear()` used to stop the expiry sweeper, which silently turned every later cache
  entry immortal.
- After `dispose()`, reject further work explicitly rather than failing obscurely later. Guard with a
  `disposed` flag checked at every entry point.

## Teardown order is part of the design

When teardown both settles pending promises and awaits in-flight ones, **settle first, await second**.
`AutoTranslate.dispose()` deadlocked because it awaited a processing queue whose promises could only
settle through the pending-batch callbacks it had not yet rejected. Write the order down in a comment
at the call site — it is not recoverable from reading the lines in isolation.

## Debouncing needs an upper bound

A pure debounce starves under a steady stream: every new arrival pushes the deadline out and the
batch never flushes. Pair the debounce window with a maximum wait (`BATCH_DEBOUNCE_MS` /
`MAX_BATCH_WAIT_MS`), set the deadline on the first arrival, and clamp each re-arm to it.

When a scheduled callback fires, **clear its handle and deadline as the first statements**, before
any early return. An early return that leaves a stale timer handle behind makes the next schedule
decision on stale data.

## Reuse the primitives

- `Semaphore(n)` for concurrency limits.
- `FileLock` for per-path write exclusion — it *is* a per-path `Semaphore(1)` with holder counting, so
  the map cannot grow without bound.
- Do not hand-roll a second FIFO wait queue. The repo had two implementations of the same primitive
  until they were collapsed.

## Promises

- No floating promises. Either `await` it, store it (`activeBatchPromise`), or attach a `.catch()` that
  routes into the `onError` hook. A rejected promise nobody handles takes the host process down on
  modern Node.
- `Promise.allSettled` when draining work you intend to finish regardless of individual failures;
  `Promise.all` only when one failure should abort the rest.
- Validate what a provider returns before indexing into it. A batch API answering with fewer results
  than requested must throw, never write `undefined` through to storage.

## Caching

- A cache entry is addressed by **every** input that changes the value. That is the
  `TranslationIdentity`: locale, namespace, the full dot path and the provider context — omitting
  namespace made two different keys collide and served the wrong translation.
- `parentKey` is folded into the path before the cache sees it, because it is not part of the
  identity: `{parentKey: 'product.meta', key: 'name'}` and `{parentKey: 'product', key: 'meta.name'}`
  address the same slot in the backend and the locale file, so they must share one entry.
- Build identities through one helper (`identityFor`) so no call site can invent its own shape.
- **Encode, never join.** Every component is consumer-supplied and may contain any separator you
  pick, so a delimiter join is not injective — `JSON.stringify([...])` is. This applies to the
  cache key, the missing-key queue key and anything else that has to tell two inputs apart.

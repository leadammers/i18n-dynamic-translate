# 004. `TranslationCache` widens to sync-or-promise in 0.2.0

| | |
|---|---|
| Status | Accepted — scheduled for 0.2.0, not implemented |
| Date | 2026-09-23 |

## Context

[003](./003-cache-identity.md) settled *how* a cache entry is addressed. It did not settle whether
a cache may be asynchronous, and the answer shipped in 0.1.0 by default: `TranslationCache.get`
returns `string | null` and `set` returns `void` (`src/types/index.ts:228`). A store that cannot
answer synchronously — Redis, DynamoDB, any network-backed cache — therefore cannot be plugged in
directly. The README tells such a consumer to keep a local `Map` as the synchronous face of the
cache and let the remote copy trail it: `get` reads the map, `set` writes the map and fires the
remote write without awaiting it, and the map is warmed from Redis at startup.

That workaround is not free, and every consumer pays it separately. It has at least three ways to
go wrong that the library could have absorbed once: lookups between process start and the warm-up
completing miss and re-translate; the un-awaited remote write has no rejection handler, so a Redis
outage surfaces as an unhandled rejection in the consumer's process rather than through `onError`;
and the map grows without the TTL sweeping that `MemoryCache` does, because it is the consumer's
own `Map`, not ours.

The stated reason for the synchronous signature — "the lookup sits in the missing-key path, between
the backend reporting a miss and the dispatch" — does not survive inspection. All three read sites
are already inside `async` methods: `processMissingKey` (`src/core/AutoTranslate.ts:294`),
`translateKey` (`:608`) and `translateObject` (`:698`). The i18next missing-key hook is
synchronous, but it does not await `processMissingKey` either way — translation is asynchronous by
design, and the caller of `t()` gets the key back on the first miss regardless. Nothing about the
architecture requires the cache to answer synchronously; the signature was a default, not a
constraint.

What *is* a real constraint is the published surface. 0.1.0 is out, and widening a return type on
an interface the public API also hands back is a breaking change (see *Consequences*), so it
cannot ride a patch release.

## Decision

In **0.2.0**, `TranslationCache.get` widens to `string | null | Promise<string | null>` and `set`
to `void | Promise<void>`, and every call site awaits. Concretely that is the three reads above,
the five writes (`:304`, `:465`, `:627`, `:642`, `:750`), and turning the synchronous
`translated.forEach(…)` at `:746` into a `for…of` so the await has somewhere to live.

**A union, not a promise.** `await` on a plain `string` costs one microtask and nothing else, so
every synchronous implementation written against 0.1.x — including the SQLite example in the
README and `MemoryCache` itself — stays valid and unchanged. Widening to `Promise` only would have
forced a rewrite on everyone to serve the minority that needs it.

**`has`, `clear` and `getStats` stay synchronous.** `clearCache()` and `getCacheStats()` are
synchronous public methods on `AutoTranslate` (`:808`, `:817`); widening those three would turn
both into promise-returning methods, which is a far louder break than the one this buys. The core
never calls `has()` at all. An async implementation backs these with whatever local state it
already keeps — which is exactly what the `Map`-in-front pattern was for, now reduced to the three
methods where it is cheap instead of all five.

`MemoryCache` is not touched. The README's `Map`-in-front section is replaced by a direct Redis
example in the same release.

## Consequences

For a consumer who only *implements* `TranslationCache` and passes it in `cache`, nothing breaks:
a wider return type accepts every value the narrower one did. The break is on the reading side.
`getConfig()` returns the live `cache` reference (`:828`), so
`autoTranslate.getConfig().cache?.get(identity)` changes from `string | null` to a union the caller
must now narrow. The same applies to any wrapper or decorator a consumer typed against
`TranslationCache` and reads through. That is narrow enough to be a minor bump rather than a major
one, but it is real, and it is why this waits for 0.2.0 instead of going into 0.1.1.

The missing-key path gains an `await` per lookup, including for the default in-memory cache. It
already awaits the backend write on the same path, so the added cost is a microtask on a hit, not
a new class of latency.

Once shipped, the union is permanent: narrowing it back to synchronous would break every async
implementation written against it, which is precisely the position 0.1.0 is in now and the reason
this is being decided deliberately rather than as a drive-by.

## Revisit when

The 0.2.0 scope is being cut and the `AutoTranslate` breakup is in it. Both change the same call
sites, and doing them in either order means touching `:294`, `:465`, `:608`, `:698` and `:746`
twice.

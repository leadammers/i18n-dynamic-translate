# 003. The cache interface takes a structured identity

| | |
|---|---|
| Status | Accepted |
| Date | 2026-09-23 |

## Context

`cache` on `AutoTranslateConfig` is documented as an extension point: a consumer can back
translation caching with Redis, SQLite or anything else by implementing `TranslationCache`
(`src/types/index.ts:228`). Before this round, that interface spread the addressing across
positional parameters — `get(key, locale, context?)`, `set(key, locale, value, context?)`,
`has(key, locale, context?)` — which commit `1dbae4f` replaced. Two problems followed directly
from that shape.

First, the parameter list was incomplete and could not be completed. `namespace` was not among
the parameters at all, so an implementation that wanted to evict or invalidate a whole namespace
had nothing to address it by; and `key` arrived as the full dot path with any `parentKey` already
folded in by the orchestrator, so the structure the caller had asked in was gone by the time it
reached `get` / `set`. Adding a fifth positional parameter afterwards would have been a breaking
change to a frozen surface, for an argument list that was already hard to read at the call site.

Second, the signature said nothing about how those values compose into one storage slot, so every
implementation had to invent that for itself. The built-in `MemoryCache` joins them with
`JSON.stringify` rather than a delimiter (`getCacheKey`, `src/utils/cache.ts:63`), because every
field is consumer-supplied and can contain whatever character a delimiter would have used as a
separator — a custom-cache author had no way to derive that from the old signature, and nothing
in the interface stopped them from getting it wrong.

An extension point a consumer cannot correctly implement is worse than no extension point:
`cache` was advertised as one before this was fixed.

Alongside that, `CacheEntry` — the internal `{ value, timestamp }` pair `MemoryCache` stores per
key (`src/types/index.ts:180`) — was exported from `src/index.ts`, but nothing public actually
needed it. `TranslationCache`'s own methods deal only in identities, strings and `null`;
`CacheEntry` appears in no public signature and is used solely inside `MemoryCache`'s private
`Map`. A consumer implementing a custom cache never has to name it, so exporting it from the
frozen public surface bought nothing and would have to be carried forever regardless.

## Decision

`TranslationCache.get` and `.set` take a `TranslationIdentity` — `key` (the full dot path, with
any `parentKey` already folded in), `locale`, an optional `namespace` and an optional DeepL
`context` (`src/types/index.ts:195`). The interface's own doc comment states the invariant a
correct implementation depends on: two lookups with equal identities must address the same cache
slot, two that differ in any field must not, and composing a storage key from the fields is the
implementation's job, not something the interface can do for it. `MemoryCache` composes its key
with `JSON.stringify([locale, namespace, key, context])` rather than a delimiter join, precisely
because every one of those fields is consumer-supplied and can contain whatever character a
delimiter would have used as a separator (`src/utils/cache.ts:64`) — the convention a custom
implementation is expected to follow.

Presence is read through `get()` returning `string | null`, not through a separate boolean
check. `has()` on the interface is optional (`src/types/index.ts:239`); the core never calls it —
every presence check in `AutoTranslate` is `this.cache?.get(identity) ?? null` followed by a
`!== null` test (`src/core/AutoTranslate.ts:294`, `:608`, `:698`), consistent with this codebase's
own convention that absence is spelled `null` and a value is never tested for truthiness. A
boolean `has()` could not distinguish a cached empty string from a miss, which is exactly the
distinction this library's caching has to preserve for a provider that legitimately returns `''`.
`has()` stays on the interface only for a custom implementation's own callers that want it — it
is not part of the contract `AutoTranslate` relies on.

`getCacheStats()` on `AutoTranslate` reads through the equally optional `TranslationCache.getStats?()`
(`src/core/AutoTranslate.ts:817`) and returns `null` when the configured cache does not implement
it, rather than reporting a hardcoded `{ size: 0 }` for every custom cache the way an unconditional
call would have to.

`CacheEntry` is unexported from `src/index.ts`. It stays exported from `@/types` — internal
modules still need to import it — and carries a doc comment explaining why it does not reach the
public surface (`src/types/index.ts:174`).

## Consequences

Every existing custom `TranslationCache` implementation written against the positional version of
the interface breaks: `get` and `set` now receive a single object where they received two to four
separate arguments, and a key composition the consumer wrote by hand no longer has the same inputs
to work from. Making that change now, before publication, means there are no such implementations
yet — the entire cost is paid before 0.1.0 rather than as a breaking change against a published
major.

`TranslationIdentity` and `CacheStats` are now permanent members of the frozen public surface;
widening either — adding a field to `TranslationIdentity` that a locale-scoped Redis
implementation would need, say — is at minimum a documented breaking change to the contract,
because an existing custom cache's `getCacheKey`-equivalent would silently stop including it.
`CacheEntry` staying unexported is comparatively free to reverse: exporting it later, if a
genuine public use turns up, is additive; removing it after publication would not have been.

## Revisit when

A concrete custom-cache use case needs an identity field this shape does not carry — a per-tenant
scope beyond locale/namespace, say — which would mean extending `TranslationIdentity` and
treating it as the breaking change to the frozen surface that it is.

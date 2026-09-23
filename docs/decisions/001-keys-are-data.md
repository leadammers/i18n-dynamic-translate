# 001. A translation key is data, never a path into the runtime

| | |
|---|---|
| Status | Accepted |
| Date | 2026-09-23 |

## Context

The whole premise of this library is that its key set is not known at build time: a key arrives
as an arbitrary string read from API metadata or a product attribute, and so do `locale`,
`namespace` and `parentKey`. Every one of them ends up as a property name — a segment in a dot
walk over a locale-file object, a flat lookup in an i18n-node catalog, or the property that
`translateObject` builds while it accumulates translated fields.

Plain property indexing does not treat those strings as inert. `target['__proto__']` does not
create an own property; it resolves to the inherited accessor on `Object.prototype` and reassigns
the prototype of `target` — and of everything that shares it — instead. A key or locale spelled
`__proto__`, `constructor` or `toString` walks off the catalog entirely, on both the read and the
write side: a lookup can return an inherited member as though it were a translation, and a write
can mutate an object the catalog was never supposed to reach.

This surfaced twice on the same branch. The first pass hardened `setNestedValue` /
`getNestedValue` (`src/utils/objectPath.ts:23`, `src/utils/objectPath.ts:91`) — the dot walk
itself — and stopped there. Review of that fix found the hole one level up: `translateKey`'s flat
`catalog[key]` lookup, the `catalog[locale]` selection above it, and the object `translateObject`
returns are the same operation as the dot walk, performed on a single segment instead of a path.
A single segment is not safer than a path; it just has one iteration.

The same review found a second defect in the fix itself. The natural hardening is
`Object.defineProperty` in place of assignment — but `defineProperty` is not a drop-in
replacement for `=`. On a sealed object, or over a property that is already non-configurable, it
throws where a plain assignment would have succeeded. A locale file read back from JSON and never
resealed is fine either way; a catalog object a consumer has frozen or sealed is not.

## Decision

Every dot-path walk and every dynamic property write in this codebase goes through
`src/utils/objectPath.ts`, which exposes `getOwnProperty`, `setOwnProperty`, `getNestedValue` and
`setNestedValue`. There is exactly one implementation of "treat this string as a property name
safely," and nothing re-derives the loop.

`getOwnProperty` reads with `Object.prototype.hasOwnProperty.call(target, name)` before indexing,
so a name that only resolves on the prototype chain reads as absent rather than as an inherited
member (`src/utils/objectPath.ts:51`).

`setOwnProperty` special-cases exactly one name. For `__proto__` it calls
`Object.defineProperty(target, name, { value, writable: true, enumerable: true, configurable:
true })`, which stores the string as an ordinary own property instead of reassigning the
prototype. Every other name is written with plain assignment, `target[name] = value`, because
assignment succeeds on sealed and non-configurable targets where `defineProperty` throws
(`src/utils/objectPath.ts:72`).

A key that collides with an object built-in is **stored, not rejected**. The alternative —
detecting `__proto__` and refusing the write — is the one path that guarantees the application
never sees a translation it explicitly asked for. Losing a translation silently is the failure
mode this library exists to prevent; a stored, retrievable value under an unusual name is a
correct result, not a compromise.

The same rule reaches `locale`, not only `key`. In the i18n-node adapter, `locale` selects a
catalog rather than indexing one of this library's own objects: `resolveCatalog`
(`src/adapters/nodeI18nAdapter.ts:205`) asks i18n-node's own `getCatalog(locale)` for the
backend's registry entry and never builds a registry of its own. i18n-node's own guarded
assignment finds the inherited `__proto__` accessor and declines to register such a locale, so
`resolveCatalog` re-checks `i18n.getLocales().includes(locale)` after attempting to add it and
raises a `BackendError` naming the locale when it is still absent. That is a different remedy for
the same principle: where this library owns the object, a colliding name is stored; where it
does not, it reports the collision rather than guessing at a workaround for someone else's
guard.

## Consequences

A locale file, an i18n-node catalog or an in-memory accumulator can legitimately hold an own
property literally named `__proto__`, `constructor` or `toString`, holding a translated string.
Anything downstream of this library that iterates such an object with a mechanism other than
`getOwnProperty` — `for...in` without a `hasOwnProperty` guard, naive `JSON.stringify` on a
frozen prototype-manipulated object, a consumer's own dot-walk utility — is exposed to the same
class of bug this fix closes, just one layer further out. This library's own serialization
(`JSON.stringify` for locale files) and the storage adapters are safe, because they operate on
plain object own properties the normal way; a consumer building custom tooling over the same
locale files should be pointed at `objectPath.ts`'s reasoning, not assumed to have it.

Every future dot-path walk or dynamic property write added to this codebase carries a discipline
cost: it must go through `getOwnProperty` / `setOwnProperty`, not a fresh `for` loop over
`path.split('.')`. The hardening is only as strong as its lack of a second implementation.

`Object.defineProperty` for the one collision case is marginally slower than an assignment, but
it runs only when the name is literally `__proto__` — every other write stays a plain assignment,
so the cost is confined to the one adversarial case it exists for.

## Revisit when

A new dynamic-property surface is added to this library (a fourth adapter, a new accumulator
pattern) and it is tempting to write a local loop instead of importing `objectPath.ts` — that is
the signal to either extend the shared module or explain in this ADR why the case is different.

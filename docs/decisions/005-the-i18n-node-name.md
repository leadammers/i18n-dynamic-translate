# 005. The second backend is called i18n-node

| | |
|---|---|
| Status | Accepted — implemented in 0.1.1 |
| Date | 2026-09-24 |

## Context

From the first commit through 0.1.0 this repository called its second backend **node-i18n** — in
the README, in `AGENTS.md`, in the architecture diagram, in adapter comments and error text, and in
the public enum member `Backend.NODE_I18N = 'node-i18n'`.

That name belongs to nothing this library supports. The package the adapter is written against is
[`i18n`](https://www.npmjs.com/package/i18n) — mashpie's [i18n-node](https://github.com/mashpie/i18n-node),
installed with `npm install i18n`, and the peer range here is `i18n: ^0.15.0`. It is healthy and
actively published. There *is* a `node-i18n` on npm, an unrelated package last published in 2022,
and pointing readers at it is the opposite of helpful. Neither package carries a formal deprecation
flag, so nothing was renamed or moved upstream — the name was wrong from the start.

The upstream project offers two usable names: the npm package `i18n`, and the repository
`i18n-node`. Bare `i18n` is unusable as a label inside an internationalisation library, where it
already means the general concept and appears in this package's own name. `i18n-node` is
unambiguous, is what the upstream repository is actually called, and is one keystroke from what
readers already have in their heads.

## Decision

**The backend is `i18n-node` everywhere** — documentation, comments, diagrams, package metadata,
the adapter class (`I18nNodeAdapter`), its file, its error text, the `backend` tag on every
`BackendError` it throws, the test fixtures, and the enum member `Backend.I18N_NODE = 'i18n-node'`.

**`Backend.NODE_I18N` stays, deprecated.** It shipped in 0.1.0, so a consumer may have written
either the member or the bare string `'node-i18n'` in a config. The member keeps its old value and
the adapter factory (`src/adapters/index.ts`) accepts both, which is what makes this rename an
additive change rather than a breaking one. Two tests pin that: the deprecated member and the bare
string both resolve to `I18nNodeAdapter`.

**Removal waits for 1.0.0 at the earliest**, and gets its own changelog entry when it happens.

## Consequences

Nothing a 0.1.0 consumer wrote stops working, which is why this could ship in 0.1.1 instead of
waiting for a minor. The alias costs one enum member and one fallthrough `case`.

One thing does change for a consumer who reads it back: `BackendError.backend` is now `'i18n-node'`
even when the backend was configured as `Backend.NODE_I18N`, and the error message text moved with
it. Leaving the tag on the old spelling would have meant a consumer selecting `I18N_NODE` and
reading `'node-i18n'` out of the error — the confusion this ADR exists to remove. Code branching on
error *message* strings breaks; code branching on the typed `backend` field sees the new value.
`BackendError` carries that field precisely so message matching is never necessary.

The npm keyword changed from `node-i18n` to `i18n-node` in the same pass. Search traffic for the
wrong name is not traffic worth keeping.

## Revisit when

1.0.0 is scoped — that is when `Backend.NODE_I18N` comes out.

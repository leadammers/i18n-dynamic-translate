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

**`Backend.NODE_I18N` is removed, not deprecated.** The obvious alternative was to keep it as an
alias until 1.0.0, and it was written that way first. What decided against it: `Backend.NODE_I18N`
existed in exactly one published version, 0.1.0, which is a day old and has no dependents. An alias
exists to protect real consumers, and there are none to protect. Carrying it would have meant the
wrong name staying visible in autocomplete, in the type, and in this repository's own tests for
every release up to 1.0.0 — paying the full cost of the mistake for the entire life of the 0.x line
in exchange for nothing.

This is a breaking change published as a patch, deliberately. Under semver it belongs in 0.2.0; that
number is already committed to the `AutoTranslate` breakup and [004](./004-async-cache.md), and
moving those is a worse trade than a patch that breaks nobody who exists. A consumer pinned to
0.1.0 is unaffected — nothing is retracted from the registry.

## Consequences

`Backend.NODE_I18N` and the bare string `'node-i18n'` no longer resolve; `createBackendAdapter`
answers them with `ConfigurationError: Unknown backend: node-i18n`, the same as any other unknown
value. Anyone who did install 0.1.0 in its first day changes one identifier.

`BackendError.backend` now reads `'i18n-node'`, and the error message text moved with it. Code
branching on error *message* strings changes; code branching on the typed `backend` field sees the
new value. `BackendError` carries that field precisely so message matching is never necessary.

The npm keyword changed from `node-i18n` to `i18n-node` in the same pass. Search traffic for the
wrong name is not traffic worth keeping.

## Revisit when

Never, for the name itself. The window in which a rename this cheap was possible is the reason it
happened now rather than being deferred; after a package has dependents the answer is the alias
this ADR rejected.

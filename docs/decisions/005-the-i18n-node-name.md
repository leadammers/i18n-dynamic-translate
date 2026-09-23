# 005. The second backend is called i18n-node, and the enum keeps the old spelling until 0.2.0

| | |
|---|---|
| Status | Accepted — docs renamed in 0.1.1, identifier rename scheduled for 0.2.0 |
| Date | 2026-09-24 |

## Context

Since the first commit this repository has called its second backend **node-i18n** — in the README,
in `AGENTS.md`, in the architecture diagram, in adapter comments and error text, and in the public
enum member `Backend.NODE_I18N = 'node-i18n'` (`src/types/index.ts:7`).

That name belongs to nothing this library supports. The package the adapter is written against is
[`i18n`](https://www.npmjs.com/package/i18n) — mashpie's [i18n-node](https://github.com/mashpie/i18n-node),
installed with `npm install i18n`, and the peer range here is `i18n: ^0.15.0`. It is healthy and
actively published. There *is* a `node-i18n` on npm, an unrelated package last published in 2022,
and pointing readers at it is the opposite of helpful. Neither package carries a formal deprecation
flag, so nothing was renamed or moved — the name was simply wrong from the start.

The upstream project offers two usable names: the npm package `i18n`, and the repository
`i18n-node`. Bare `i18n` is unusable as a label inside an internationalisation library, where it
already means the general concept and appears in this package's own name. `i18n-node` is
unambiguous, is what the upstream repository is actually called, and is one keystroke from what
readers already have in their heads.

## Decision

**In prose, the backend is `i18n-node`.** Every document, comment and diagram was renamed in 0.1.1.
Where the name is first introduced, it says which npm package it is (`i18n`) and links both the
package and the repository, because "i18n-node" alone does not tell a reader what to install.

**The identifier keeps the old spelling for now.** `Backend` is exported from `src/index.ts`, so
`Backend.NODE_I18N` and its value `'node-i18n'` are frozen public API under critical rule 1 — a
consumer may have written either the member or the bare string. The same holds for the `backend`
tag on every `BackendError` the adapter throws and for the error message text, which a consumer may
be matching on. None of that can move in a patch release, and 0.1.1 is a patch.

**In 0.2.0 the identifier follows the prose.** `Backend.I18N_NODE = 'i18n-node'` is added,
`Backend.NODE_I18N` stays as a `@deprecated` alias, and the adapter factory (`src/adapters/index.ts:19`)
accepts both. Error text and the `BackendError` backend tag move to `i18n-node` in the same release,
so that the value a consumer reads back matches the name they configured. The alias is removed at
1.0.0 at the earliest.

## Consequences

0.1.1 changes no behaviour: the rename is documentation, comments and package metadata only. It
does leave one visible seam — the docs say `i18n-node` while the code example beside them says
`Backend.NODE_I18N`. The prerequisites section names that seam and points here, which is a better
state than documentation that confidently points at an abandoned package.

For 0.2.0, adding an enum member and widening a `switch` breaks nobody; the deprecated alias means
even a consumer who wrote the bare string `'node-i18n'` keeps working. The error-text change is the
only part that can surprise, and it surprises only code matching on message strings, which this
repository's own conventions tell consumers not to do (`BackendError` carries a typed `backend`
field for exactly that reason).

The npm keyword changed from `node-i18n` to `i18n-node` in the same pass. Search traffic for the
wrong name is not traffic worth keeping.

## Revisit when

0.2.0 scope is cut. This rides along with the `AutoTranslate` breakup and [004](./004-async-cache.md):
all three touch the adapter call sites, and doing them separately means three passes over the same
files.

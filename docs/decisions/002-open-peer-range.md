# 002. The i18next peer range stays open above the tested majors

| | |
|---|---|
| Status | Accepted |
| Date | 2026-09-23 |

## Context

`package.json` declares `"i18next": ">=23.0.0"` as an optional peer dependency
(`package.json:92`). The floor is not arbitrary: the i18next adapter touches exactly four points
of i18next's API — `options.missingKeyHandler`, `options.saveMissing`, `getFixedT` and
`addResource` — and all four have been stable since i18next v19. 23 was chosen as a round, current
floor, not because anything below it is known to fail.

Until this round, nothing had actually run against that claim. `tools/smoke/check.mjs` closes
that gap: it packs the library into a real tarball, installs it into a scratch project alongside
a pinned i18next version, and drives one missing key through a stub provider into a live i18next
instance and out to a YAML file — the same four touch points a consumer's application would
exercise. It repeats once per entry in a `SUPPORTED_I18NEXT` list (`tools/smoke/check.mjs:22`),
currently `['23', '24', '25', '26']`, and runs in CI on every pull request as well as in
`publish.yml` before a release.

That leaves a choice about what the *range* itself should say once the tested majors are known:
cap it at 26, the newest one actually proven, or leave `>=23.0.0` open.

A cap is the conservative-looking choice, but it does not describe reality. This package touches
four long-stable methods; nothing about the shape of an i18next major bump — new features
elsewhere in i18next, changes to areas this library never calls — is likely to break any of them.
Capping the range at the newest tested major would mark every fresh i18next release "unsupported"
by npm's own dependency resolution the moment it ships, for a library with no active maintenance
cadence of its own yet, and would stay that way until this package's next release re-widens it.
For a four-method surface, an untested-but-plausibly-fine major is a better failure mode for a
consumer than a peer-resolution error blocking `npm install` outright.

## Decision

`i18next: ">=23.0.0"` stays open with no upper bound. `SUPPORTED_I18NEXT` in
`tools/smoke/check.mjs` is the list of majors actually proven end to end from an installed
tarball, and it is separate from the range: the range is what npm allows a consumer to resolve,
the list is what CI has actually driven through the adapter.

The range being open is not a promise that stops requiring proof. It obliges whoever maintains
this package to add the new major to `SUPPORTED_I18NEXT` — and watch the smoke job pass against
it — in the same commit that would otherwise be "just update the README." A major that fails the
smoke run means the range needs an upper bound at that point, or the adapter needs a fix; a major
that is never added to the list is a claim ahead of its evidence, which is exactly the state this
decision is meant to end.

The equivalent claim for the TypeScript compiler range works the same way, one layer over:
`docs/conventions/typescript.md` documents `SUPPORTED_TYPESCRIPT`
(`tools/compat/check.mjs`) as what `npm run compat:types` actually compiles against, distinct
from the range published in the README.

## Consequences

A consumer can install this package against an i18next major that has never been run through the
smoke check — the guarantee is "the four methods this library calls have been stable since v19
and nothing suggests otherwise," not "every major has been driven end to end." That is weaker
than a capped range, and it is a deliberate trade against the alternative failure mode: a
consumer blocked from installing at all against a perfectly compatible new major, for a package
that may go a while between releases.

The obligation this creates is easy to let slide. Nothing in CI fails when a new i18next major
ships and `SUPPORTED_I18NEXT` is not updated — the smoke job only checks the versions already
listed. Keeping the range honest depends on a maintainer noticing the release and doing the work,
not on a gate that forces it.

## Revisit when

A smoke run against a new i18next major fails — that is the concrete trigger to either fix the
adapter or cap the range at the last major that passed. Absent a failure, a new major simply goes
into `SUPPORTED_I18NEXT` in the same commit as the README update and the range is left as is.

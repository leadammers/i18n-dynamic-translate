# 006. Widening a public optional property is not free in output positions

| | |
|---|---|
| Status | Accepted — implemented in 0.1.2 |
| Date | 2026-09-25 |

## Context

Turning on `exactOptionalPropertyTypes` (0.1.2) forced a choice at every optional property in the
codebase: widen `foo?: T` to `foo?: T | undefined`, or stop writing `undefined` into it. The rule
adopted for the split is in `docs/conventions/typescript.md` — widen on anything reachable from
`src/index.ts`, omit inside the library — and the reasoning was that widening only ever *accepts*
more, so it cannot break a caller and therefore cannot violate the frozen-API rule in
[AGENTS.md](../../AGENTS.md).

That reasoning covers input positions and only input positions. Every optional property on
`AutoTranslateConfig` is also an output: `AutoTranslate.getConfig()` returns
`Readonly<AutoTranslateConfig>`. For a consumer who has the flag on themselves, a property that
now includes `undefined` no longer assigns to a narrower declaration of their own:

```ts
interface NarrowConfig {
    autoSave?: boolean;
}
const narrow: NarrowConfig = instance.getConfig();
// TS2375: Type 'Readonly<AutoTranslateConfig>' is not assignable to type 'NarrowConfig'
// with 'exactOptionalPropertyTypes: true'.
```

Verified against a built `dist/` on `refactor/exact-optional-property-types` with TypeScript 5.9,
5.0, 6 and 7. It does not reproduce for a consumer who leaves the flag off, and it does not
reproduce for a consumer who uses the returned value without re-declaring its shape — the failure
needs both the flag and a hand-written target type. The plan for 0.1.2 carried the incomplete
version of the rule as its acceptance criterion 2, "every change to a type exported from
`src/index.ts` is a widening", and it passed: every change *was* a widening. The criterion was
measuring the wrong direction.

Three options were on the table once this was understood.

**Revert the public half of the widening** and instead stop passing `undefined` at every internal
call site that touches a public type. This keeps the declarations byte-identical to 0.1.1, but it
also keeps the thing the flag was turned on to fix: a consumer on `exactOptionalPropertyTypes`
still cannot write `{ namespace: undefined }`, and cannot round-trip a `Partial<>` or an object
spread back into the library — which is what people actually write. It trades a compile error in a
narrow output case for a compile error in a common input case.

**Ship it as 0.2.0** rather than 0.1.2, on the grounds that a type error in someone else's build is
a break whatever direction it points in. Semver below 1.0.0 allows a break in a minor, and the
repository says so at the top of `CHANGELOG.md`, so this is the conservative reading.

**Ship it as 0.1.2 and record the decision here.** The package has no consumers yet — 0.1.0 and
0.1.1 published days ago, and the download counts are our own CI. The cost of the break is
therefore zero in practice, and paying a minor version for it spends a version number on nobody.

## Decision

The widening stands, and 0.1.2 stays a patch.

The deciding fact is that there are no consumers to break. Every argument for 0.2.0 is an argument
about consumers who do not exist; the moment one does, this reasoning expires, which is what the
"Revisit when" section below is for. Reverting the widening was rejected on the merits rather than
on cost: it would leave the library rejecting explicit `undefined` forever, which is the more
common and more surprising of the two failures.

Two documents were corrected rather than the code. `CHANGELOG.md` no longer claims the change is a
"widening, not a break" without qualification — it states the output-side `TS2375` outright, shows
the failing assignment and gives the one-token fix on the consumer's side. The rule in
`docs/conventions/typescript.md` now says that widening a public optional property widens input
positions, costs output positions, is still the right answer, and belongs in the changelog rather
than being filed as a pure widening.

Optional *methods* are a separate matter and are unaffected: `has?(identity): boolean` must keep
method syntax, because rewriting it to `has?: ((identity) => boolean) | undefined` swaps bivariant
parameter checking for contravariant and genuinely narrows what a consumer may assign. That is
recorded in the conventions and rides along with [ADR 004](004-async-cache.md) in 0.2.0.

## Consequences

The frozen-API rule in `AGENTS.md` keeps its wording, but "widening" can no longer be read as a
synonym for "safe". A change that widens a public optional property is safe for callers and may
cost an assignment for a consumer who receives the value into a narrower type, and that second
half now has to be stated in the changelog every time it applies. The 0.1.2 plan's acceptance
criterion 2 was true as written and still insufficient; a future plan that reuses the phrasing
should say "widening in input positions, with output-side assignability checked" instead.

Deciding this on "there are no consumers" only works if a would-be consumer can find that out
before depending on the package, so the policy it rests on is now written down where they will look:
the README lists it among the honest limits, `CHANGELOG.md` says it in its header, and
`docs/conventions/releasing.md` spells out that below 1.0.0 a breaking change is allowed in any
bump, patch included, and must be called out in the entry. The version number is not the signal
here; the changelog is.

A consumer who hits this has a one-token fix in their own code — add `| undefined` to the property
in their declaration — which is why documenting it was judged proportionate to the harm. Nothing in
the library's runtime behaviour changes; this is a declaration-file-only effect and the compiled
JavaScript is unaffected.

Future flags in the same family — `noUncheckedIndexedAccess` went in on `feature/cache-contract`
before this, `useUnknownInCatchVariables` and friends may follow — get the same treatment: check
both directions against a built `dist/` with a probe consumer before calling the change a widening.

## Revisit when

The package has real consumers. From that point a change of this shape is a documented breaking
change and takes a minor bump, not a patch — the argument above is entirely contingent on there
being nobody to break, and it stops holding the day that changes.

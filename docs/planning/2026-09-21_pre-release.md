# Pre-release — 0.1.0, the first npm publish

**Status:** open
**Created:** 2026-09-21
**Scope:** everything that must be true before `i18n-dynamic-translate@0.1.0` reaches npm.

This file holds the **decisions and one-off setup** for the first publish. The mechanical release
steps — changelog rename, `npm version`, tagging, what the publish workflow enforces — live in
[docs/conventions/releasing.md](../conventions/releasing.md) and are not repeated here. Work through
this file first, then follow that one.

The organising rule: **do now only what is expensive to change after 0.1.0 is on npm.** Anything
internal and invisible to consumers belongs in [TODO.md](../../TODO.md) instead, and is listed under
*Deliberately deferred* at the bottom so it does not get relitigated.

---

## 1. Blockers

Each of these fails the publish or ships the wrong thing. None is optional.

### 1.1 `NPM_TOKEN` does not exist

`.github/workflows/publish.yml` authenticates with `secrets.NPM_TOKEN`. The repository currently
has **no Actions secrets at all**, so the publish step would fail at authentication after the whole
build and test gate has run.

- [ ] Create an npm **granular access token** scoped to this package with read-and-write permission
- [ ] Add it as the `NPM_TOKEN` repository secret
- [ ] Prefer an expiring token and note the expiry, so a failed release a year from now is
      immediately explicable

### 1.2 Provenance requires a public repository

The workflow publishes with `npm publish --provenance --access public`. npm's documented
prerequisite is a **public `repository` field matching where the publish runs from**; this
repository is currently `private`. The publish is expected to fail while that is the case.

Two ways out, and they are not equivalent:

| Option | Consequence |
|---|---|
| **Make the repository public** | Provenance works. CodeQL starts running by itself (its job is already gated on visibility). gitleaks needs no licence on public repos. This is the intended end state for an MIT-licensed npm library. |
| **Drop `--provenance`** | Publishes from a private repository, but gives up the supply-chain attestation that much of this review round was spent building. Only sensible if the source is staying closed. |

- [ ] Decide: public repository, or publish without provenance
- [ ] If dropping provenance, also remove `id-token: write` from the publish job and the provenance
      claim from the PR body and README

> Verify the exact failure mode against a dry run rather than trusting this note — npm documents the
> public-repository prerequisite but not what it does when the prerequisite is unmet.

### 1.3 `main` is the default branch and is 67 commits behind `dev`

A GitHub Release created from the default branch checks out `main`. Publishing today would ship the
code from *before* this review round, and the version-equals-tag guard would happily pass, because
`package.json` on `main` also says `0.1.0`. This is the quietest way to ship the wrong thing.

- [ ] Merge `dev` into `main` **before** tagging (owner is handling this), or switch the default
      branch to `dev`
- [ ] Confirm `git rev-list --count origin/main..origin/dev` is `0` immediately before creating the
      release

---

## 2. Decisions on the frozen surface

`src/index.ts` is frozen until a major bump. These cost minutes now and a major version later.

### 2.0 The cache contract — settled on `feature/cache-contract`

`TranslationCache` took one pre-encoded string, so an implementation could neither scope by
locale nor invalidate by namespace, and the orchestrator's encoding was encoded a second time by
the cache. It now takes a `TranslationIdentity` — locale, namespace, full dot path (with any
`parentKey` already folded in) and provider context. `getCacheStats()` returns `{ size }` and
works through the optional `TranslationCache.getStats()`, so it no longer reports `null` for
every custom cache.

- [x] `TranslationIdentity` and `CacheStats` added to the public surface, documented in the
      README's *Custom Cache* section
- [x] `getCacheStats()` reads the configured cache, not only the built-in one

The point of doing this before 0.1.0: the `cache` option is advertised as an extension point, and
an extension point nobody can implement is worse than none.

### 2.1 `CacheEntry` is exported but nothing needs it

`TranslationCache` became usable this round through the new `cache` config option, so its export now
earns its place. `CacheEntry` did not: it appears in no public signature — `TranslationCache`'s
methods deal only in strings and `null` — and is used solely inside `MemoryCache`. A consumer
implementing a custom cache never has to name it.

- [x] Unexported from `src/index.ts`. It stays exported from `@/types` for `MemoryCache`'s own use
      and carries a comment saying why it is not public

Removing it after publication would have been a breaking change; adding it back later is not.

### 2.2 Rotate the DeepL API key — optional

Downgraded from the original review's 🔴 after checking the evidence: the key is free-tier (`:fx`),
and it never entered git history, a stash, or any push. The tracked REST file that once held it now
carries a placeholder and is untracked and gitignored.

- [ ] Rotate if you want the belt-and-braces version; no evidence requires it

---

## 3. What CI proves about the support claims — settled on `feature/release-hardening`

Every claim a consumer reads was a hand-written assertion. Three of them are now checked on every
pull request, and the last of them found a bug that would have shipped.

### 3.1 The Node floor is the floor that runs

The test matrix pinned `22`, which npm resolves to the newest 22.x — a release could have used an
API added after 22.12 and passed. The matrix is now `['22.12', 22, 24]`, so the exact `engines`
floor is exercised alongside both current LTS lines. `compat:package` also runs in
`publish.yml`: a broken `exports` map is only visible once the tarball is assembled, and that job
is the last point before npm.

- [x] `22.12` pinned in the CI matrix, verified locally against a real 22.12 install
- [x] `publish.yml` gates on the same packaging checks CI runs

### 3.2 The packed tarball is installed and driven end to end

`npm run smoke` packs the library, installs it into a scratch project with `i18next` and `js-yaml`,
and runs one missing key through a stub provider into a live i18next instance and out to a YAML
file. This is the only check that exercises the shipped artifact through a consumer's
`node_modules` — including the lazy `js-yaml` import, which resolves from a different place in an
installed package than in the repository.

**It found a defect on its first run.** A real i18next reports a failed lookup to the missing-key
handler, and it reports it against the *fallback* language rather than the one looked up. So the
library's own read of the source language came straight back as a miss for the target locale, and
re-entered the handler for the key it was already processing: unbounded recursion,
`RangeError: Maximum call stack size exceeded`, before a single translation was written. The unit
suite passed throughout, because its i18next mock returns the key without ever reporting a miss —
the mock hid the very interaction the adapter exists to hook.

Fixed in two parts: the in-flight queue entry is now reserved before the work starts rather than
after it, and the reads the library makes itself no longer count as application misses (which also
removes a duplicate provider call on every explicit `translateKey`). Both are covered by
regression tests using a mock that reports misses the way i18next does.

- [x] `npm run smoke` and a `smoke` job in CI
- [x] `fix(core)`: reserve the queue entry before processing; fence the library's own backend reads

### 3.3 The i18next peer range is tested, not guessed

`i18next >=23.0.0` was plausible — the adapter touches only `missingKeyHandler`, `saveMissing`,
`getFixedT` and `addResource`, stable since v19 — but nothing had run against it. The smoke check
now repeats for every entry in `SUPPORTED_I18NEXT`: majors 23, 24, 25 and 26 all pass.

The range **stays open above 26** rather than being capped at what is tested. An upper bound would
mark every fresh i18next major unsupported until this package released again, which is a worse
failure mode for a four-method surface than an untested-but-likely-fine major. A new major goes
into `SUPPORTED_I18NEXT` and the claim is re-proven.

- [x] Majors 23–26 driven end to end from an installed tarball
- [x] Decision recorded: open range, tested list, documented in the README

---

## 4. Pre-flight

Run immediately before tagging, not now — several of these go stale.

- [ ] `npm run format:check && npm run typecheck && npm run build && npm test` — the gate from
      `AGENTS.md`
- [ ] `npm pack --dry-run` shows only `dist/`, `src/`, `CHANGELOG.md`, `LICENSE`, `README.md`,
      `package.json`. **Verified clean on 2026-09-21:** 89 files, 67.2 kB packed, no tests,
      fixtures, `.env` or docs
- [ ] `CHANGELOG.md`: replace `## [0.1.0] — unreleased` and its "nothing published yet" note with
      the tag date, and open a fresh `## [Unreleased]` above it
- [ ] README's documented API and Node floor match what ships (22.12)
- [ ] `npm view i18n-dynamic-translate` still 404s — the name was free on 2026-09-21 but is not
      reserved
- [ ] Tag `v0.1.0` equals `package.json` version. No tags exist in the repository yet

---

## 5. Deliberately deferred

Not blockers. All internal, all cheap to do after publishing, listed so they are not rediscovered as
"surely this should happen first".

- **Break up `core/AutoTranslate.ts`** (809 lines, over the guideline). Invisible to consumers; a
  large behaviour-preserving refactor deserves its own branch, not release pressure.
- **`exactOptionalPropertyTypes` (~50 errors).** Internal type-safety work.
  `noUncheckedIndexedAccess` was pulled forward instead and is now on: it is the flag that would
  have caught the DeepL `{ translations: [{}] }` bug at compile time.
- **Translator error-path tests.** Valuable, non-breaking.
- **Edge-runtime support.** `node:fs` is statically imported through `fileHandler` →
  `FileStorageAdapter` → `AutoTranslate`, so the module will not load on Cloudflare Workers or
  Vercel Edge even with a custom `StorageAdapter`. Fixing it means a lazy `import()` behind the
  default adapter. Non-breaking to add later; build it when someone asks.

Browser support is **not** on this list and is not a gap: the library holds a provider API key and
writes locale files, so shipping it to a client would leak the key. See the README's Prerequisites.

---

## 6. State at creation

Captured 2026-09-21, from PR #9 (`chore/review-2026-09-21` → `dev`), all checks green.

| Fact | Value |
|---|---|
| Version | `0.1.0`, unpublished, name free on npm |
| Tags | none |
| Default branch | `main`, 67 commits behind `dev` after PR #9 merged |
| Visibility | private |
| Actions secrets | none |
| Tests | 281 passing (262 when this file was written) |
| `npm audit` | 0 vulnerabilities; `dependencies` empty, all three peers optional |
| Licence | MIT, `LICENSE` present and matching `package.json` |

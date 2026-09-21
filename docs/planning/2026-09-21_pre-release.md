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

### 1.3 `main` is the default branch and is 39 commits behind `dev`

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

### 2.1 `CacheEntry` is exported but nothing needs it

`TranslationCache` became usable this round through the new `cache` config option, so its export now
earns its place. `CacheEntry` did not: it appears in no public signature — `TranslationCache`'s
methods deal only in strings and `null` — and is used solely inside `MemoryCache`. A consumer
implementing a custom cache never has to name it.

- [ ] Either unexport `CacheEntry` from `src/index.ts`, or accept it as permanent surface

Recommendation: **unexport it.** Removing it after publication is a breaking change; adding it back
later is not.

### 2.2 Rotate the DeepL API key — optional

Downgraded from the original review's 🔴 after checking the evidence: the key is free-tier (`:fx`),
and it never entered git history, a stash, or any push. The tracked REST file that once held it now
carries a placeholder and is untracked and gitignored.

- [ ] Rotate if you want the belt-and-braces version; no evidence requires it

---

## 3. Pre-flight

Run immediately before tagging, not now — several of these go stale.

- [ ] `npm run format:check && npm run typecheck && npm run build && npm test` — the gate from
      `AGENTS.md`
- [ ] `npm pack --dry-run` shows only `dist/`, `src/`, `CHANGELOG.md`, `LICENSE`, `README.md`,
      `package.json`. **Verified clean on 2026-09-21:** 89 files, 67.2 kB packed, no tests,
      fixtures, `.env` or docs
- [ ] `CHANGELOG.md`: rename `## [Unreleased]` to `## [0.1.0] — <date>` and open a fresh
      `## [Unreleased]` above it
- [ ] README's documented API and Node floor match what ships (22.12)
- [ ] `npm view i18n-dynamic-translate` still 404s — the name was free on 2026-09-21 but is not
      reserved
- [ ] Tag `v0.1.0` equals `package.json` version. No tags exist in the repository yet

---

## 4. Deliberately deferred

Not blockers. All internal, all cheap to do after publishing, listed so they are not rediscovered as
"surely this should happen first".

- **Break up `core/AutoTranslate.ts`** (809 lines, over the guideline). Invisible to consumers; a
  large behaviour-preserving refactor deserves its own branch, not release pressure.
- **`exactOptionalPropertyTypes` (~50 errors) and `noUncheckedIndexedAccess` (~36).** Internal
  type-safety work.
- **Translator error-path tests.** Valuable, non-breaking.
- **Two key-converter edge cases** — already-spaced keys get title-cased; a leading lowercase letter
  before an acronym splits badly (`iOSDevice` → `I OS Device`).
- **Edge-runtime support.** `node:fs` is statically imported through `fileHandler` →
  `FileStorageAdapter` → `AutoTranslate`, so the module will not load on Cloudflare Workers or
  Vercel Edge even with a custom `StorageAdapter`. Fixing it means a lazy `import()` behind the
  default adapter. Non-breaking to add later; build it when someone asks.

Browser support is **not** on this list and is not a gap: the library holds a provider API key and
writes locale files, so shipping it to a client would leak the key. See the README's Prerequisites.

---

## 5. State at creation

Captured 2026-09-21, from PR #9 (`chore/review-2026-09-21` → `dev`), all checks green.

| Fact | Value |
|---|---|
| Version | `0.1.0`, unpublished, name free on npm |
| Tags | none |
| Default branch | `main`, 39 commits behind `dev` |
| Visibility | private |
| Actions secrets | none |
| Tests | 262 passing |
| `npm audit` | 0 vulnerabilities; `dependencies` empty, all three peers optional |
| Licence | MIT, `LICENSE` present and matching `package.json` |

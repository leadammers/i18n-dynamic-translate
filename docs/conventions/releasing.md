# Releasing

The package publishes to npm from CI, never from a laptop. `npm publish` run by hand skips the
provenance attestation and the version guard.

## Versioning

Semantic Versioning. While the version is `0.x`, breaking changes are allowed in a minor bump — say
so in the changelog entry rather than silently shipping them.

## Steps

1. Land everything on `dev` and confirm it is green.
2. Update `CHANGELOG.md`: give the version's heading today's date and open a fresh
   `## [Unreleased]` above it. Until 0.1.0 ships there is no `[Unreleased]` section — the
   `## [0.1.0] — unreleased` heading is what gets dated. The sections follow
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): Added / Changed / Deprecated / Removed /
   Fixed / Security.
3. `npm version <major|minor|patch>` — this writes `package.json`, the lockfile and a `v<version>` tag.
4. Merge `dev` into `main` via PR.
5. Push the tag, then create a **GitHub Release** on it. Publishing the release triggers
   `.github/workflows/publish.yml`.

## What the publish workflow enforces

Nothing reaches npm until all of these pass:

- `npm audit --omit=dev --audit-level=high` — the runtime dependency surface must be clean.
- `npm run build`, `npm test`, and the path-alias leak check on `dist/`.
- **The version in `package.json` must equal the release tag**, so tagging `v1.2.3` against a
  `1.2.2` manifest fails the job instead of publishing the wrong version.
- `npm publish --provenance --access public`, which attests the build back to this repo and commit.

`prepublishOnly` re-runs typecheck, build and tests, so a manual publish attempt still gates — it
just lacks provenance and the tag check.

## Checklist

- [ ] `CHANGELOG.md` has a dated entry for this version, with breaking changes called out.
- [ ] `npm run typecheck && npm run format:check && npm test` pass locally.
- [ ] `npm pack --dry-run` lists only `dist/`, `src/`, `CHANGELOG.md`, `LICENSE`, `README.md` and
      `package.json` — no `.env`, tests or fixtures.
- [ ] README's documented API and minimum Node version match what shipped.
- [ ] The tag and `package.json` version agree.

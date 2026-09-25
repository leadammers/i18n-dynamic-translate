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

- `npm --version` is at least 11.5.1, which is what trusted publishing needs. `node-version: 24`
  resolves well past the 24.5.0 that first bundled it, so the check is a guard against a confusing
  failure rather than a live constraint: npm too old to use a trusted publisher reports a generic
  "need auth" that reads as a broken publisher setup.
- `npm audit --omit=dev --audit-level=high` — the runtime dependency surface must be clean.
- `npm run build`, `npm test`, and the path-alias leak check on `dist/`.
- **The version in `package.json` must equal the release tag**, so tagging `v1.2.3` against a
  `1.2.2` manifest fails the job instead of publishing the wrong version.
- `npm publish`, authenticated over OIDC as the package's **trusted publisher**. npmjs.com pins
  that right to this repository and to the filename `publish.yml`, so no npm credential exists
  here to leak and no other workflow in this repository can publish over OIDC. It does not by
  itself stop a token from publishing: npm removed classic tokens in November 2025, but a granular
  access token created with "bypass 2FA" still publishes non-interactively. Closing that door is
  the package setting **"Require two-factor authentication and disallow tokens"** under Publishing
  access on npmjs.com, which refuses granular tokens whatever their bypass flag says and leaves
  trusted publishing working, since OIDC is not token auth. That is a registry setting and not
  visible from this repository, so whether it is on has to be checked there. The provenance
  attestation, which ties the tarball back to this repository and commit, is minted from the same
  token — hence no `--provenance` flag. `--access public` is gone too; `publishConfig.access` already says it.
  The job runs with `package-manager-cache: false`, because a poisoned dependency cache would run
  attacker-controlled code in the one job holding a token npm accepts as this package's publisher.
  CI's jobs keep their cache; they have nothing to spend.

`prepublishOnly` re-runs typecheck, build and tests, so a manual publish attempt still gates — it
just lacks provenance and the tag check.

## Proving the support claims

`engines.node` is the only support claim npm reads at install time, and even that one it does not
enforce: `engine-strict` defaults to `false`, so a mismatch prints a warning rather than refusing
the install. Only a consumer who has turned `engine-strict` on is actually blocked by it. There is
no `engines.typescript`, and a peer range says which versions are *allowed*, not which were tried.
So every support claim here is proven by the `compat` job in CI rather than left to the manifest:

- `npm run compat:types` type-checks `tools/compat/consumer.ts` — a consumer that imports every
  exported type from the built `dist/` — against each TypeScript version in `SUPPORTED_TYPESCRIPT`
  (`tools/compat/check.mjs`), under `strict`. Widening the README's range means adding the version
  there and watching it pass.
- `npm run compat:package` runs `attw --pack . --profile node16` and `publint`: the first resolves
  the package the way a CJS consumer, an ESM consumer and a bundler each would, the second checks
  the manifest's `exports`, `main` and `types` agree with what is in the tarball.

- `npm run smoke` packs the tarball, installs it into a scratch project alongside `i18next` and
  `js-yaml`, and runs `tools/smoke/consumer.cjs` against it: one missing key through a stub
  provider, into a live i18next instance and out to a YAML file. `compat:package` checks that the
  package *resolves*; this checks that it *runs*, through the `node_modules` a consumer gets.
  The consumer is copied into the scratch project first — run from the repository, Node's package
  self-reference would resolve the import back to the source tree and prove nothing.
  It repeats once per entry in `SUPPORTED_I18NEXT` (`tools/smoke/check.mjs`), which is what turns
  the `i18next >=23.0.0` peer range from a claim into a tested one. A new i18next major goes into
  that list; the range itself stays open, because the adapter only uses `missingKeyHandler`,
  `saveMissing`, `getFixedT` and `addResource`, and an upper bound would mark every fresh major
  unsupported until this package released again.

All three are cheap and run on every pull request, so a change that breaks an older compiler, a
consumer shape or the installed package fails before it is released rather than in someone's
install.

## Checklist

- [ ] `CHANGELOG.md` has a dated entry for this version, with breaking changes called out.
- [ ] `npm run typecheck && npm run format:check && npm test` pass locally.
- [ ] `npm pack --dry-run` lists only `dist/`, `src/`, `CHANGELOG.md`, `LICENSE`, `README.md` and
      `package.json` — no `.env`, tests or fixtures.
- [ ] README's documented API, minimum Node version and TypeScript range match what shipped —
      the range is the one `tools/compat/check.mjs` actually compiles.
- [ ] The tag and `package.json` version agree.

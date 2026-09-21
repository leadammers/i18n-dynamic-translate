# Security Policy

## Supported Versions

`i18n-dynamic-translate` is pre-1.0. Only the latest published minor line
receives security fixes; older lines are not patched.

| Version | Supported          | Notes                                        |
| ------- | ------------------ | -------------------------------------------- |
| 0.1.x   | :white_check_mark: | Current release line                          |
| < 0.1   | :x:                | Unreleased / pre-publication, not supported   |

Once 1.0.0 is released, this table is updated so that the current major line
and the previous minor of that line are supported.

## Reporting a Vulnerability

**Please do not open a public issue, pull request or discussion for a security
problem.** A public report tells attackers about the flaw before a fix exists.

Report privately through GitHub's private vulnerability reporting:

1. Go to
   <https://github.com/adalea-dev/i18n-dynamic-translate/security/advisories/new>
   (repository → **Security** tab → **Report a vulnerability**).
2. Describe the issue.

Helpful details to include:

- Affected version(s) and the translation provider involved (DeepL,
  LibreTranslate, custom adapter), if relevant
- A minimal reproduction: configuration, locale files, and the call that
  triggers the problem
- The impact you believe it has (e.g. API key disclosure, path traversal when
  writing locale files, denial of service)
- Any suggested fix or mitigation

**Never include real API keys, tokens or other live credentials in a report.**
Redact them and describe the shape of the value instead.

### What to Expect

| Stage                   | Target                                              |
| ----------------------- | --------------------------------------------------- |
| Acknowledgement         | within 3 business days                               |
| Initial assessment      | within 10 business days                              |
| Fix and release         | depends on severity; critical issues are prioritised |

We will keep you updated on the advisory thread, credit you in the published
advisory unless you ask us not to, and coordinate the disclosure timing with
you. Fixes are shipped as a new patch release together with a GitHub Security
Advisory.

## Scope

In scope:

- The published `i18n-dynamic-translate` package and its source in this
  repository
- The CI/CD and release workflows in `.github/workflows/`

Out of scope:

- Vulnerabilities in the upstream translation services themselves (DeepL,
  LibreTranslate) — report those to the respective provider
- Vulnerabilities in third-party dependencies that already have a public
  advisory; those are tracked via Dependabot and `npm audit`
- Findings that require an attacker to already control the host process,
  the configuration file, or the API key

## Handling Credentials

This library talks to third-party translation APIs and therefore handles API
keys.

- Supply keys through environment variables (see `.env.example`), never by
  committing them. `.env` and `.env.*` are gitignored; only `.env.example`
  is tracked.
- API keys are never written to locale files, caches or logs by this library.
  If you find a code path that does log or persist a key, treat it as a
  security issue and report it privately.
- The repository is scanned on every push and pull request with CodeQL
  (static analysis), `npm audit` (dependency advisories) and Gitleaks
  (secret scanning over the full git history). Secret-scanning findings are
  reported without echoing the matched value.

## Security Measures in This Repository

- All third-party GitHub Actions are pinned to a full commit SHA.
- Every workflow declares an explicit least-privilege `permissions:` block
  (`contents: read` by default, elevated per job only where required).
- Releases are published to npm with
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
  so the published tarball can be traced back to the commit and workflow that
  built it.
- Dependabot opens weekly update pull requests for npm and GitHub Actions.

# Security Conventions

For reporting a vulnerability, see [SECURITY.md](../../SECURITY.md). This file covers what to do
while writing code.

## Credentials

- A provider API key exists in exactly two places: the consumer's config object, and the
  `Authorization` header built at request time. It goes nowhere else — not into a log line, not into
  an error message, not into a cache key, not into a thrown object's fields.
- **All HTTP failures are described by `describeHttpError()`** in `@/utils/http`, which maps status
  codes to messages and deliberately drops the request URL and body. Adding a provider means adding a
  status-message map, not writing a new error ladder that might interpolate the request.
- `getConfig()` returns a deep copy, so a caller cannot reach in and read or mutate live provider
  options.
- Never write a key into a fixture, a scratch `.http` file or a test. Use `.env.dev` (gitignored) and
  `{{DEEPL_API_KEY}}` placeholders. CI runs gitleaks over the full history.

## Filesystem

- Consumer-supplied `locale` and `namespace` values reach path construction. **Path resolution and
  traversal validation happen in exactly one place** (`getLocaleFilePath`), which resolves the
  candidate and verifies it stays inside `localesPath`.
- Lower-level write helpers accept an already-validated absolute path. Do not export them from
  `src/index.ts` and do not call them with a path that has not been through the validator — that
  would create a second, unchecked entrance.
- Concurrent writes to one file go through `FileLock`. Read-modify-write on a locale file without the
  lock loses translations under load.

## Keys as data

A translation key is an arbitrary string from outside the build — API metadata, product
attributes, whatever the host application looked up. It is **data, never a path into the
runtime**.

- Dot paths are walked with **own properties only**, on both the read and the write side, in
  `setNestedValue` / `getNestedValue` (`@/utils/fileHandler`). Plain indexing resolves
  `__proto__` to `Object.prototype` and `toString` to a function, so a key could otherwise
  write through the prototype chain into every object in the process, or have an inherited
  member returned to the application as a translation.
- A segment is stored with `Object.defineProperty`, not `target[segment] = value`. `__proto__`
  is an inherited accessor: a plain assignment reassigns the prototype instead of storing the
  key, which both corrupts the process and loses the translation.
- A key that collides with an object built-in is kept, not rejected. Dropping it would silently
  lose a translation the application asked for; the point is to store it as an ordinary own
  property.
- Any new dot-path walk goes through those two functions rather than re-deriving the loop —
  the hardening only holds if there is one implementation of it.

## Dependencies

- **`dependencies` stays empty.** Every added runtime dependency becomes a supply-chain surface for
  everyone who installs this package. Optional functionality (`js-yaml`) is a lazy `import()` behind
  an optional peer dependency.
- A peer-dependency range is a security boundary: it decides what consumers are allowed to resolve.
  When an advisory covers part of a range, raise the floor past it rather than relying on the
  lockfile, which consumers do not inherit.
- `npm audit --omit=dev` must stay clean — that is the surface consumers actually install. Dev-only
  advisories are fixed promptly but do not block a release on their own.

## Input from providers

Treat a translation API response as untrusted input: check array lengths before indexing, and do not
assume a field is present because the documentation says so.

# Decisions

Architecture decision records. One file per settled decision, numbered in the order they were
taken. A record is not a plan and not a changelog entry: it says what the alternatives were and why
this one won, so a later session does not reopen a question that was already answered. Supersede a
record by link rather than by rewriting it.

| # | Decision | Status | Date |
|---|---|---|---|
| [001](001-keys-are-data.md) | A translation key is data, never a path into the runtime | Accepted | 2026-09-23 |
| [002](002-open-peer-range.md) | The i18next peer range stays open above the tested majors | Accepted | 2026-09-23 |
| [003](003-cache-identity.md) | The cache interface takes a structured identity | Accepted | 2026-09-23 |
| [004](004-async-cache.md) | `TranslationCache` widens to sync-or-promise in 0.2.0 | Accepted — scheduled for 0.2.0, not implemented | 2026-09-23 |
| [005](005-the-i18n-node-name.md) | The second backend is called i18n-node | Accepted — implemented in 0.1.1 | 2026-09-24 |
| [006](006-widening-is-not-free.md) | Widening a public optional property is not free in output positions | Accepted — implemented in 0.1.2 | 2026-09-25 |

New record: copy the shape of an existing one — `# NNN. <title>`, a status/date table, then
**Context**, **Decision**, **Consequences** and **Revisit when** — and add its row here in the same
commit. `AGENTS.md` links this folder, so a record without a row is a record nobody finds.

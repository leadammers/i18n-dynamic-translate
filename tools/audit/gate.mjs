/**
 * `npm audit --audit-level=high` over the full tree, minus a short, named list of
 * advisories that have no fix to upgrade to. npm has no ignore flag, so without
 * this one unpatchable dev-only advisory blocks every pull request.
 *
 * Only the full-tree step uses it. The production audit (`--omit=dev`) stays a
 * plain `npm audit`: that is what consumers install, and nothing is excused there.
 *
 * An ignore entry that stops matching is reported, so the list shrinks once the
 * fix ships instead of silently outliving it.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Advisories excused from the full-tree audit. Each needs a reason and the
 * condition under which it comes off — see "Dependencies" in
 * docs/conventions/security.md.
 */
export const IGNORED_ADVISORIES = [
    {
        // braces <= 3.0.3, no patched release. Reached only through tsc-alias
        // (chokidar 3, globby 11 → micromatch), which expands this repository's own
        // tsconfig globs at build time; no untrusted pattern ever reaches it.
        // Remove when braces ships a fix or tsc-alias stops depending on it.
        id: 'GHSA-vfj7-8cjw-p6xm',
        package: 'braces',
    },
];

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/**
 * @param {unknown} report parsed `npm audit --json` output
 * @param {readonly string[]} ignoredIds GHSA ids to excuse
 * @returns {{ blocking: { id: string, name: string, severity: string, title: string }[], unusedIgnores: string[] }}
 */
export function findBlockingAdvisories(report, ignoredIds) {
    if (typeof report !== 'object' || report === null || typeof report.vulnerabilities !== 'object') {
        throw new Error('npm audit did not produce an audit report');
    }

    /** @type {Map<string, { id: string, name: string, severity: string, title: string }>} */
    const advisories = new Map();
    for (const vulnerability of Object.values(report.vulnerabilities)) {
        // A bare string in `via` names a vulnerable dependency, not an advisory. That
        // dependency has its own entry carrying the advisory object, so following
        // the objects alone covers the tree — and an ignored advisory takes the
        // packages that merely inherit it along with it.
        for (const cause of vulnerability.via ?? []) {
            if (typeof cause !== 'object' || cause === null) {
                continue;
            }
            const id = String(cause.url ?? cause.source)
                .split('/')
                .pop();
            advisories.set(id, { id, name: cause.name, severity: cause.severity, title: cause.title });
        }
    }

    const ignored = new Set(ignoredIds);
    const blocking = [...advisories.values()].filter(
        (advisory) => BLOCKING_SEVERITIES.has(advisory.severity) && !ignored.has(advisory.id)
    );
    const unusedIgnores = ignoredIds.filter((id) => !advisories.has(id));

    return { blocking, unusedIgnores };
}

function main() {
    // npm audit exits non-zero whenever it finds anything, so the exit code says
    // nothing here; the parsed report decides.
    const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const { blocking, unusedIgnores } = findBlockingAdvisories(
        JSON.parse(audit.stdout),
        IGNORED_ADVISORIES.map((entry) => entry.id)
    );

    for (const id of unusedIgnores) {
        console.log(`::warning::${id} is ignored in tools/audit/gate.mjs but no longer reported — remove it`);
    }
    for (const advisory of blocking) {
        console.log(`${advisory.severity}\t${advisory.name}\t${advisory.id}\t${advisory.title}`);
    }
    if (blocking.length > 0) {
        console.log(`${blocking.length} high or critical advisories. Run \`npm audit\` for details.`);
        process.exit(1);
    }
    console.log('No high or critical advisories outside the ignore list.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

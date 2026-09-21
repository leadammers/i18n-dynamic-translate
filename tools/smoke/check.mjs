/**
 * Installs the packed tarball into a scratch project and runs a consumer against
 * it. `npm pack --dry-run` only lists filenames; this is what proves the artifact
 * works — that `main`, `exports` and `types` point at files that shipped, and that
 * the optional peers resolve from a real install.
 *
 * Deliberately not a Vitest test: Vitest resolves `@/` through the repository's
 * tsconfig, which is exactly the resolution this is meant to avoid.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONSUMER = join(REPO_ROOT, 'tools', 'smoke', 'consumer.cjs');

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

const scratch = mkdtempSync(join(tmpdir(), 'i18n-smoke-project-'));

try {
    run('npm', ['pack', '--pack-destination', scratch], REPO_ROOT);
    const tarball = readdirSync(scratch).find((entry) => entry.endsWith('.tgz'));
    if (!tarball) {
        throw new Error('npm pack produced no tarball');
    }

    writeFileSync(
        join(scratch, 'package.json'),
        `${JSON.stringify({ name: 'smoke-consumer', version: '1.0.0', private: true }, null, 2)}\n`
    );

    // The peers are optional, so a consumer installs only what it uses. This one
    // uses i18next and YAML files, so it installs both.
    run('npm', ['install', '--no-audit', '--no-fund', `./${tarball}`, 'i18next', 'js-yaml'], scratch);

    // The consumer has to live inside the scratch project. Run from the repository
    // it would resolve `i18n-dynamic-translate` to the repository itself, through
    // Node's self-reference for a package with an `exports` map — and test nothing.
    const installedConsumer = join(scratch, 'consumer.cjs');
    copyFileSync(CONSUMER, installedConsumer);
    run('node', [installedConsumer], scratch);
} finally {
    rmSync(scratch, { recursive: true, force: true });
}

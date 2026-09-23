/**
 * Installs the packed tarball into a scratch project and runs a consumer against
 * it. `npm pack --dry-run` only lists filenames; this is what proves the artifact
 * works — that `main`, `exports` and `types` point at files that shipped, and that
 * the optional peers resolve from a real install.
 *
 * It runs once per i18next major in SUPPORTED_I18NEXT, which is how the
 * `>=23.0.0` peer range stops being a guess: the adapter touches only
 * `options.missingKeyHandler`, `options.saveMissing`, `getFixedT` and
 * `addResource`, and each major here is driven through all four. Extend the list
 * when a new major ships and widen the peer range in the same commit.
 *
 * Deliberately not a Vitest test: Vitest resolves `@/` through the repository's
 * tsconfig, which is exactly the resolution this is meant to avoid.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_I18NEXT = ['23', '24', '25', '26'];

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONSUMER = join(REPO_ROOT, 'tools', 'smoke', 'consumer.cjs');

const run = (command, args, cwd, stdio = 'inherit') =>
    execFileSync(command, args, { cwd, stdio, encoding: 'utf8' });

const packed = mkdtempSync(join(tmpdir(), 'i18n-smoke-pack-'));
let failed = false;

try {
    run('npm', ['pack', '--pack-destination', packed], REPO_ROOT, ['ignore', 'pipe', 'pipe']);
    const tarball = readdirSync(packed).find((entry) => entry.endsWith('.tgz'));
    if (!tarball) {
        throw new Error('npm pack produced no tarball');
    }

    for (const version of SUPPORTED_I18NEXT) {
        const scratch = mkdtempSync(join(tmpdir(), 'i18n-smoke-project-'));
        process.stdout.write(`i18next@${version}: `);

        try {
            writeFileSync(
                join(scratch, 'package.json'),
                `${JSON.stringify({ name: 'smoke-consumer', version: '1.0.0', private: true }, null, 2)}\n`
            );

            // The peers are optional, so a consumer installs only what it uses.
            // This one uses i18next and YAML files, so it installs both.
            run(
                'npm',
                [
                    'install',
                    '--no-audit',
                    '--no-fund',
                    join(packed, tarball),
                    `i18next@${version}`,
                    'js-yaml',
                ],
                scratch,
                ['ignore', 'pipe', 'pipe']
            );

            // The consumer has to live inside the scratch project. Run from the repository
            // it would resolve `i18n-dynamic-translate` to the repository itself, through
            // Node's self-reference for a package with an `exports` map — and test nothing.
            const installedConsumer = join(scratch, 'consumer.cjs');
            copyFileSync(CONSUMER, installedConsumer);
            console.log(run('node', [installedConsumer], scratch, ['ignore', 'pipe', 'pipe']).trim());
        } catch (error) {
            failed = true;
            console.log('FAILED');
            console.log(`${error.stdout ?? ''}${error.stderr ?? ''}`.trim());
        } finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    }
} finally {
    rmSync(packed, { recursive: true, force: true });
}

if (failed) {
    console.error('\nThe installed package does not work on every supported i18next major.');
    process.exit(1);
}

/**
 * Compile `tools/compat/consumer.ts` against every TypeScript version the README
 * claims to support, so the claim is checked rather than asserted.
 *
 * Extend SUPPORTED_TYPESCRIPT when the floor moves or a new major ships; the
 * README badge and CHANGELOG must say the same thing as the first entry here.
 */
import { execFileSync } from 'node:child_process';

const SUPPORTED_TYPESCRIPT = ['5.0', '5.9', '6', '7'];
const PROJECT = 'tools/compat/tsconfig.json';

let failed = false;

for (const version of SUPPORTED_TYPESCRIPT) {
    process.stdout.write(`typescript@${version}: `);
    try {
        execFileSync('npx', ['-y', '-p', `typescript@${version}`, 'tsc', '--noEmit', '-p', PROJECT], {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
        });
        console.log('ok');
    } catch (error) {
        failed = true;
        console.log('FAILED');
        console.log(`${error.stdout ?? ''}${error.stderr ?? ''}`.trim());
    }
}

if (failed) {
    console.error('\nThe published declarations do not compile on every supported TypeScript version.');
    process.exit(1);
}

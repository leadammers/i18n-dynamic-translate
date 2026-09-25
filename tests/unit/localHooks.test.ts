/**
 * The pre-push hook inlines the credential clearing that `OFFLINE` in the Makefile owns, so that
 * the hook keeps working on a machine without `make` on PATH. That leaves two copies of one fact,
 * and two copies drift: add a provider variable to `OFFLINE` and forget the hook, and every push
 * from then on reaches a live API. These tests are the guard that the two stay in step.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT: string = path.resolve(__dirname, '..', '..');

function readRepoFile(relativePath: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** The names of every `NAME=""` pair in a shell fragment, in source order. */
function clearedCredentials(fragment: string): string[] {
    const assignments: RegExpMatchArray[] = [...fragment.matchAll(/\b([A-Z][A-Z0-9_]*)=""/g)];
    return assignments.map((assignment: RegExpMatchArray): string => assignment[1]);
}

describe('local git hooks', () => {
    describe('pre-push', () => {
        it('clears exactly the credentials the Makefile clears', () => {
            const offlineDefinition: RegExpMatchArray | null =
                readRepoFile('Makefile').match(/^OFFLINE\s*:?=\s*(.*)$/m);
            if (offlineDefinition === null) {
                throw new Error('Makefile no longer defines OFFLINE, which .husky/pre-push mirrors.');
            }

            const expected: string[] = clearedCredentials(offlineDefinition[1]);
            expect(expected).toContain('DEEPL_API_KEY');
            expect(expected).toContain('LIBRETRANSLATE_URL');

            expect(clearedCredentials(readRepoFile('.husky/pre-push'))).toEqual(expected);
        });

        it('clears them on the line that runs the suite, not in a line of their own', () => {
            const prePush: string = readRepoFile('.husky/pre-push');
            const testInvocation: string | undefined = prePush
                .split('\n')
                .find((line: string): boolean => line.includes('npm test'));

            expect(testInvocation).toBeDefined();
            for (const credential of clearedCredentials(prePush)) {
                expect(testInvocation).toContain(`${credential}=""`);
            }
        });

        it('does not depend on make being installed', () => {
            expect(readRepoFile('.husky/pre-push')).not.toMatch(/^\s*make\b/m);
        });
    });
});

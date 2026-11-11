import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface PackageJson {
    description: string;
    keywords: string[];
}

interface PackedFile {
    path: string;
}

const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as PackageJson;

// Top-level files the tarball ships besides the dist/ and src/ trees. A new entry
// here is a deliberate decision, not something that slips in through `files`.
const EXPECTED_TOP_LEVEL_FILES = ['AGENTS.md', 'CHANGELOG.md', 'LICENSE', 'README.md', 'llms.txt', 'package.json'];

describe('package metadata', () => {
    it('names the backend and both providers in the description', () => {
        for (const term of ['i18next', 'DeepL', 'LibreTranslate']) {
            expect(packageJson.description).toContain(term);
        }
    });

    it('declares 10 to 15 unique keywords', () => {
        expect(packageJson.keywords.length).toBeGreaterThanOrEqual(10);
        expect(packageJson.keywords.length).toBeLessThanOrEqual(15);
        expect(new Set(packageJson.keywords).size).toBe(packageJson.keywords.length);
    });

    it('ships only the expected top-level files next to dist/ and src/', () => {
        const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        const [packed] = JSON.parse(output) as { files: PackedFile[] }[];
        const topLevel = packed.files
            .map((file: PackedFile) => file.path)
            .filter((path: string) => !path.startsWith('dist/') && !path.startsWith('src/'))
            .sort();

        expect(topLevel).toEqual(EXPECTED_TOP_LEVEL_FILES);
    });
});

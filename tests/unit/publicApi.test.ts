import { describe, it, expect } from 'vitest';
import * as publicApi from '@/index';

// `src/index.ts` is the public API, and critical rule 1 freezes what it names for
// the rest of the current minor. `tools/compat/consumer.ts` already type-checks the
// exported *types* against every supported TypeScript version; what nothing checked
// was the runtime half — that each value is still exported, and that nothing new
// slipped in. An accidental export is the expensive mistake, because removing it
// afterwards is the breaking change.
const PUBLIC_RUNTIME_EXPORTS = [
    'AutoTranslate',
    'AutoTranslateError',
    'Backend',
    'BackendError',
    'ConfigurationError',
    'DeepLModelType',
    'FileFormat',
    'FileStorageAdapter',
    'FileSystemError',
    'TranslationError',
    'TranslationProvider',
] as const;

// The enum *members* are as much of the frozen surface as the enum names, and the
// string each one carries is what reaches a consumer's config, a `BackendError.backend`
// tag and their locale files. 0.1.1 removed `Backend.NODE_I18N` deliberately — see
// docs/decisions/005-the-i18n-node-name.md — and nothing but `tsc` over this repo's own
// usages noticed. This table is what notices next time.
const PUBLIC_ENUM_MEMBERS: Record<string, Record<string, string>> = {
    Backend: {
        I18NEXT: 'i18next',
        I18N_NODE: 'i18n-node',
    },
    TranslationProvider: {
        LIBRE_TRANSLATE: 'libretranslate',
        DEEPL: 'deepl',
    },
    FileFormat: {
        JSON: 'json',
        YAML: 'yaml',
    },
    DeepLModelType: {
        LATENCY: 'latency_optimized',
        QUALITY: 'prefer_quality_optimized',
    },
};

describe('public API surface', () => {
    it('exports every documented runtime value', () => {
        for (const name of PUBLIC_RUNTIME_EXPORTS) {
            expect(publicApi[name], `${name} is no longer exported`).toBeDefined();
        }
    });

    it('exports nothing beyond them', () => {
        // Filtered by value, not by name: the test transform keeps the names of the
        // type-only re-exports and binds them to `undefined`, where `tsc` elides them
        // outright — `dist/index.js` has exactly the eleven below. Comparing the
        // values is what makes this assertion about the shipped surface rather than
        // about whichever bundler ran.
        const runtimeExports = Object.keys(publicApi)
            .filter((name: string) => publicApi[name as keyof typeof publicApi] !== undefined)
            .sort();

        expect(runtimeExports).toEqual([...PUBLIC_RUNTIME_EXPORTS]);
    });

    it('pins every enum member and the string it carries', () => {
        for (const [enumName, expectedMembers] of Object.entries(PUBLIC_ENUM_MEMBERS)) {
            const actual = publicApi[enumName as keyof typeof publicApi] as unknown as Record<string, string>;

            // Compared as a whole object rather than member by member, so a member
            // that was *added* fails here too: adding one is cheap to do by accident
            // and expensive to take back.
            expect(actual, `${enumName} changed its members`).toEqual(expectedMembers);
        }
    });

    it('exports the error classes as a hierarchy consumers can branch on', () => {
        // A consumer catching AutoTranslateError has to catch all four of the others,
        // which is the contract `instanceof` checks in a host app depend on.
        for (const ErrorClass of [
            publicApi.TranslationError,
            publicApi.BackendError,
            publicApi.FileSystemError,
            publicApi.ConfigurationError,
        ]) {
            expect(new ErrorClass('probe')).toBeInstanceOf(publicApi.AutoTranslateError);
            expect(new ErrorClass('probe')).toBeInstanceOf(Error);
        }
    });
});

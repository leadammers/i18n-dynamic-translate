import { describe, expect, it } from 'vitest';
import { findBlockingAdvisories } from '../../tools/audit/gate.mjs';

const BRACES_URL = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const SOURCE_MAP_URL = 'https://github.com/advisories/GHSA-68fv-2mgg-jv7q';

const advisory = (name: string, url: string, severity: string): Record<string, unknown> => ({
    source: 1,
    name,
    dependency: name,
    title: `${name} advisory`,
    url,
    severity,
    range: '*',
});

// The shape `npm audit --json` prints: one entry per affected package, whose
// `via` holds advisory objects for the package itself and bare package names
// for the vulnerable dependencies it pulls in.
const report = {
    auditReportVersion: 2,
    vulnerabilities: {
        braces: { name: 'braces', severity: 'high', via: [advisory('braces', BRACES_URL, 'high')] },
        chokidar: { name: 'chokidar', severity: 'high', via: ['braces'] },
        micromatch: { name: 'micromatch', severity: 'high', via: ['braces'] },
        'source-map-js': {
            name: 'source-map-js',
            severity: 'high',
            via: [advisory('source-map-js', SOURCE_MAP_URL, 'high')],
        },
        tiny: {
            name: 'tiny',
            severity: 'moderate',
            via: [advisory('tiny', 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', 'moderate')],
        },
    },
};

describe('findBlockingAdvisories', () => {
    it('blocks on every high advisory when nothing is ignored', () => {
        const result = findBlockingAdvisories(report, []);

        expect(result.blocking.map((found: { id: string }) => found.id).sort()).toEqual([
            'GHSA-68fv-2mgg-jv7q',
            'GHSA-vfj7-8cjw-p6xm',
        ]);
        expect(result.unusedIgnores).toEqual([]);
    });

    it('drops an ignored advisory together with the packages that only inherit it', () => {
        const result = findBlockingAdvisories(report, ['GHSA-vfj7-8cjw-p6xm']);

        expect(result.blocking.map((found: { id: string }) => found.id)).toEqual(['GHSA-68fv-2mgg-jv7q']);
    });

    it('passes when every high advisory is ignored', () => {
        const result = findBlockingAdvisories(report, ['GHSA-vfj7-8cjw-p6xm', 'GHSA-68fv-2mgg-jv7q']);

        expect(result.blocking).toEqual([]);
    });

    it('lists the same advisory once even when several packages report it', () => {
        const duplicated = {
            vulnerabilities: {
                one: { via: [advisory('braces', BRACES_URL, 'high')] },
                two: { via: [advisory('braces', BRACES_URL, 'high')] },
            },
        };

        expect(findBlockingAdvisories(duplicated, []).blocking).toHaveLength(1);
    });

    it('treats critical as blocking and moderate as not', () => {
        const mixed = {
            vulnerabilities: {
                bad: { via: [advisory('bad', 'https://github.com/advisories/GHSA-crit-crit-crit', 'critical')] },
                meh: { via: [advisory('meh', 'https://github.com/advisories/GHSA-mode-mode-mode', 'moderate')] },
            },
        };

        expect(findBlockingAdvisories(mixed, []).blocking.map((found: { id: string }) => found.id)).toEqual([
            'GHSA-crit-crit-crit',
        ]);
    });

    it('reports an ignore entry that no longer matches anything, so it gets removed', () => {
        const result = findBlockingAdvisories(report, ['GHSA-vfj7-8cjw-p6xm', 'GHSA-gone-gone-gone']);

        expect(result.unusedIgnores).toEqual(['GHSA-gone-gone-gone']);
    });

    it('throws on output that is not an audit report instead of passing', () => {
        expect(() => findBlockingAdvisories({ error: { code: 'ENOLOCK' } }, [])).toThrow(/audit report/);
    });
});

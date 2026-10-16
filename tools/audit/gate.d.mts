export interface BlockingAdvisory {
    id: string;
    name: string;
    severity: string;
    title: string;
}

export declare const IGNORED_ADVISORIES: readonly { id: string; package: string }[];

export declare function findBlockingAdvisories(
    report: unknown,
    ignoredIds: readonly string[]
): { blocking: BlockingAdvisory[]; unusedIgnores: string[] };

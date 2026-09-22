/**
 * File Handler Utility
 * Async operations for reading and writing locale files (JSON/YAML)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileFormat, LocaleData } from '@/types';

let yaml: typeof import('js-yaml') | undefined;

async function getYaml(): Promise<typeof import('js-yaml')> {
    if (!yaml) {
        yaml = await import('js-yaml');
    }
    return yaml;
}
import { FileSystemError } from '@/utils/errors';

/**
 * Detect file format from file path
 */
export function detectFileFormat(filePath: string): FileFormat {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
        return FileFormat.YAML;
    }
    return FileFormat.JSON;
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Read locale file (JSON or YAML)
 */
export async function readLocaleFile(filePath: string): Promise<LocaleData> {
    try {
        const exists = await fileExists(filePath);
        if (!exists) {
            return {};
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const fileFormat = detectFileFormat(filePath);

        if (fileFormat === FileFormat.YAML) {
            const yamlLib = await getYaml();
            const data = yamlLib.load(content);
            return (data as LocaleData) || {};
        } else {
            return JSON.parse(content || '{}');
        }
    } catch (error) {
        throw new FileSystemError(`Failed to read locale file: ${filePath}`, filePath, error as Error);
    }
}

/**
 * Ensure parent directory exists, creating it recursively if needed
 */
async function ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
}

/**
 * Write locale file (JSON or YAML)
 */
export async function writeLocaleFile(filePath: string, data: LocaleData): Promise<void> {
    try {
        const fileFormat = detectFileFormat(filePath);
        let content: string;

        if (fileFormat === FileFormat.YAML) {
            const yamlLib = await getYaml();
            content = yamlLib.dump(data, { indent: 2, lineWidth: -1 });
        } else {
            content = JSON.stringify(data, null, 2) + '\n';
        }

        // Ensure parent directory exists before writing
        await ensureDirectoryExists(filePath);

        await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
        throw new FileSystemError(`Failed to write locale file: ${filePath}`, filePath, error as Error);
    }
}

/**
 * Set a nested value in an object using dot notation
 * @param obj - The object to modify
 * @param path - Dot-separated path (e.g., 'user.profile.name')
 * @param value - Value to set
 */
export function setNestedValue(obj: LocaleData, path: string, value: string | LocaleData): void {
    const keys = path.split('.');
    // `split` never returns an empty array, so the leaf key always exists.
    const leafKey = keys.pop() ?? path;
    let current: LocaleData = obj;

    for (const key of keys) {
        // `typeof null === 'object'`, so null has to be excluded explicitly or the
        // property write below throws on a locale file that holds one.
        const branch = readOwnSegment(current, key);
        if (typeof branch !== 'object' || branch === null) {
            writeOwnSegment(current, key, {});
        }
        current = readOwnSegment(current, key) as LocaleData;
    }

    writeOwnSegment(current, leafKey, value);
}

/**
 * Read one path segment, ignoring anything inherited from the prototype chain.
 *
 * A key arrives here as an arbitrary string — that is the whole point of a
 * library whose keys come from API metadata rather than a build. Plain indexing
 * would resolve `__proto__` to `Object.prototype`, and `toString` or `valueOf`
 * to a function, so a walk could leave the catalog entirely and report whatever
 * it found there as a translation.
 */
function readOwnSegment(target: LocaleData, segment: string): string | LocaleData | undefined {
    if (!Object.prototype.hasOwnProperty.call(target, segment)) {
        return undefined;
    }

    return target[segment];
}

/**
 * Write one path segment as an own property.
 *
 * `__proto__` is an accessor inherited from `Object.prototype`, so `target[key] =
 * value` would reassign the prototype of `target` — and of everything sharing it
 * — instead of storing a key. Defining the property stores the segment as the
 * data the caller meant, for that name and every other, with no special case.
 */
function writeOwnSegment(target: LocaleData, segment: string, value: string | LocaleData): void {
    Object.defineProperty(target, segment, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
}

/**
 * Get a nested value by dot notation, or null if the path does not lead to a string.
 * @param obj - The object to read from
 * @param path - Dot-separated path (e.g., 'user.profile.name')
 */
export function getNestedValue(obj: LocaleData, path: string): string | null {
    let current: string | LocaleData | undefined = obj;

    for (const segment of path.split('.')) {
        if (typeof current !== 'object' || current === null) {
            return null;
        }
        current = readOwnSegment(current, segment);
    }

    return typeof current === 'string' ? current : null;
}

/**
 * Get locale file path
 * @param localesPath - Base path to locales directory
 * @param locale - Locale code (e.g., 'en', 'fr')
 * @param namespace - Optional namespace for i18next
 * @param format - File format
 */
export async function getLocaleFilePath(
    localesPath: string,
    locale: string,
    namespace?: string,
    format?: FileFormat
): Promise<string> {
    // Determine file extension, defaulting to JSON if format is not specified
    const ext = format === FileFormat.YAML ? 'yaml' : 'json';
    const basePath = namespace ? path.join(localesPath, locale, namespace) : path.join(localesPath, locale);

    // Validate the resolved path stays within localesPath to prevent path traversal
    const resolvedBase = path.resolve(basePath);
    const resolvedLocales = path.resolve(localesPath);
    if (!resolvedBase.startsWith(resolvedLocales + path.sep) && resolvedBase !== resolvedLocales) {
        throw new FileSystemError(`Path traversal detected: locale or namespace escapes localesPath`, resolvedBase);
    }

    if (format) {
        return `${basePath}.${ext}`;
    }

    // Auto-detect format by checking for existing files
    for (const candidate of ['yaml', 'yml', 'json']) {
        const filePath = `${basePath}.${candidate}`;
        if (await fileExists(filePath)) {
            return filePath;
        }
    }

    return `${basePath}.${ext}`;
}

/**
 * Append translation to locale file
 * @param filePath - Path to the locale file
 * @param key - Translation key
 * @param value - Translation value
 * @param parentKey - Optional parent key to nest translations under
 */
export async function appendTranslationToFile(
    filePath: string,
    key: string,
    value: string,
    parentKey?: string
): Promise<void> {
    const data = await readLocaleFile(filePath);
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    setNestedValue(data, fullKey, value);
    await writeLocaleFile(filePath, data);
}

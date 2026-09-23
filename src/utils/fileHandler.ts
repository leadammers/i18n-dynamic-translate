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
import { setNestedValue } from '@/utils/objectPath';

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
 * Whether a YAML document carries nothing but blank lines and comments.
 *
 * js-yaml v4 returned `undefined` for such a document, v5 throws
 * `expected a document, but the input is empty`. The peer range stays open
 * across both majors, so emptiness is decided here instead of depending on
 * either version's answer.
 */
function isBlankYamlDocument(content: string): boolean {
    return content.split('\n').every((line: string): boolean => {
        const trimmed = line.trim();
        return trimmed === '' || trimmed.startsWith('#');
    });
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
            if (isBlankYamlDocument(content)) {
                return {};
            }

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

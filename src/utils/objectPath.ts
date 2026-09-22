/**
 * Object Path Utility
 * Dot-notation reads and writes over translation catalogs.
 *
 * A translation key reaches this module as an arbitrary string from outside the
 * build — API metadata, product attributes, whatever the host application looked
 * up. It is data, never a path into the runtime, so every segment is read and
 * written as an own property. Plain indexing would resolve `__proto__` to
 * `Object.prototype` and `toString` to a function.
 */

import { LocaleData } from '@/types';

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

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

/** The only property name that an assignment resolves to an inherited setter. */
const PROTOTYPE_ACCESSOR = '__proto__';

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
        const branch = getOwnProperty(current, key);
        if (typeof branch !== 'object' || branch === null) {
            setOwnProperty(current, key, {});
        }
        current = getOwnProperty(current, key) as LocaleData;
    }

    setOwnProperty(current, leafKey, value);
}

/**
 * Read one property, ignoring anything inherited from the prototype chain.
 *
 * A key arrives here as an arbitrary string — that is the whole point of a
 * library whose keys come from API metadata rather than a build. Plain indexing
 * would resolve `__proto__` to `Object.prototype`, and `toString` or `valueOf`
 * to a function, so a lookup could leave the catalog entirely and report whatever
 * it found there as a translation.
 */
export function getOwnProperty(target: LocaleData, name: string): string | LocaleData | undefined {
    if (!Object.prototype.hasOwnProperty.call(target, name)) {
        return undefined;
    }

    return target[name];
}

/**
 * Write one property as an own property.
 *
 * `__proto__` is the one name an assignment does not store: it is an accessor
 * inherited from `Object.prototype`, so `target[name] = value` reassigns the
 * prototype of `target` — and of everything sharing it — or, for a string, does
 * nothing at all and loses the translation. Defining the property stores the
 * data the caller meant.
 *
 * Every other name is assigned, because defining is not a drop-in replacement:
 * on a sealed target, or over a non-configurable property, `defineProperty`
 * throws where an assignment succeeds.
 */
export function setOwnProperty(target: LocaleData, name: string, value: string | LocaleData): void {
    if (name !== PROTOTYPE_ACCESSOR) {
        target[name] = value;
        return;
    }

    Object.defineProperty(target, name, {
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
        current = getOwnProperty(current, segment);
    }

    return typeof current === 'string' ? current : null;
}

/**
 * Key Converter Utility
 * Converts camelCase and snake_case keys to readable English text
 */

/**
 * Convert a camelCase or snake_case key to readable English text
 * @param key - The key to convert
 * @returns Readable English text
 *
 * @example
 * convertKeyToText('userName') // 'User Name'
 * convertKeyToText('user_name') // 'User Name'
 * convertKeyToText('user-name') // 'User Name'
 */
export function convertKeyToText(key: string): string {
    if (!key || typeof key !== 'string') {
        return '';
    }

    // Handle dot notation (e.g., 'user.profile.userName')
    const parts = key.split('.');
    const lastPart = parts[parts.length - 1];

    let result = lastPart
        // Handle snake_case: user_name -> user name
        .replaceAll('_', ' ')
        // Handle kebab-case: user-name -> user name
        .replaceAll('-', ' ')
        // Handle camelCase: userName -> user Name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        // Handle PascalCase and consecutive capitals: XMLParser -> XML Parser
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        // Trim and normalize spaces
        .trim()
        .replace(/\s+/g, ' ');

    // Capitalize first letter of each word, preserving all-uppercase acronyms
    result = result
        .split(' ')
        .map((word) => {
            if (word === word.toUpperCase() && word.length > 1) {
                return word; // Preserve acronyms like "API", "URL", "XML"
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');

    return result;
}

/**
 * Convert a key to a sentence (first letter capitalized only)
 * @param key - The key to convert
 * @returns Sentence-style text
 *
 * @example
 * convertKeyToSentence('userName') // 'User name'
 */
export function convertKeyToSentence(key: string): string {
    const text = convertKeyToText(key);
    if (!text) return '';

    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Check if a key is likely a nested path
 * @param key - The key to check
 * @returns True if the key contains dots
 */
export function isNestedKey(key: string): boolean {
    return key.includes('.');
}

/**
 * Get the last segment of a nested key
 * @param key - The key to extract from
 * @returns The last segment
 *
 * @example
 * getLastSegment('user.profile.name') // 'name'
 */
export function getLastSegment(key: string): string {
    const parts = key.split('.');
    return parts[parts.length - 1];
}

/**
 * Get the parent path of a nested key
 * @param key - The key to extract from
 * @returns The parent path or empty string
 *
 * @example
 * getParentPath('user.profile.name') // 'user.profile'
 */
export function getParentPath(key: string): string {
    const parts = key.split('.');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('.');
}

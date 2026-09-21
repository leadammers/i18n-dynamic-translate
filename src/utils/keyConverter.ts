/**
 * Key Converter Utility
 * Converts camelCase and snake_case keys to readable English text
 */

/**
 * Placeholder that survives the split passes and is stripped afterwards. A control
 * character cannot occur in a translation key, so it can never collide with one.
 */
const ACRONYM_GLUE = '\u0000';

/**
 * Convert a camelCase or snake_case key to readable English text
 * @param key - The key to convert
 * @returns Readable English text
 *
 * @example
 * convertKeyToText('userName') // 'User Name'
 * convertKeyToText('user_name') // 'User Name'
 * convertKeyToText('user-name') // 'User Name'
 * convertKeyToText('apiURL') // 'Api URL'
 * convertKeyToText('order2Status') // 'Order 2 Status'
 * convertKeyToText('iOSDevice') // 'iOS Device'
 * convertKeyToText('Order confirmed') // 'Order confirmed' — already readable
 */
export function convertKeyToText(key: string): string {
    if (!key || typeof key !== 'string') {
        return '';
    }

    // Handle dot notation (e.g., 'user.profile.userName')
    const parts = key.split('.');
    // `split` never returns an empty array, so the last part always exists.
    const lastPart = (parts[parts.length - 1] ?? key).trim();

    // A key made only of words and spaces is a sentence someone wrote by hand, not a
    // programmatic identifier. Title-casing it ('order confirmed' -> 'Order Confirmed')
    // damages text that was already fine, so pass it through. A separator or a camelCase
    // boundary means it is an identifier after all, spaces or not, and still needs the
    // full pipeline — otherwise 'estimated_delivery date' would reach the provider raw.
    const hasIdentifierShape = /[_-]/.test(lastPart) || /[a-z][A-Z]/.test(lastPart);
    if (/\s/.test(lastPart) && !hasIdentifierShape) {
        return lastPart.replace(/\s+/g, ' ');
    }

    let result = lastPart
        // Keep `iOS` together: a single lowercase letter in front of an acronym belongs
        // to it, so the camelCase split below must not cut there. The marker is removed
        // again once every split has run.
        .replace(/(?<![A-Za-z0-9])([a-z])([A-Z]{2,})/g, `$1${ACRONYM_GLUE}$2`)
        // Handle snake_case: user_name -> user name
        .replaceAll('_', ' ')
        // Handle kebab-case: user-name -> user name
        .replaceAll('-', ' ')
        // Handle camelCase: userName -> user Name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        // Handle PascalCase and consecutive capitals: XMLParser -> XML Parser
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        // Handle digit boundaries: order2Status -> order 2 Status. Without this
        // the whole run stays one word and its inner capital is lowercased away.
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2')
        // Trim and normalize spaces
        .trim()
        .replace(/\s+/g, ' ')
        .replaceAll(ACRONYM_GLUE, '');

    // Capitalize first letter of each word, preserving acronyms
    result = result
        .split(' ')
        .map((word: string) => {
            // Any run of two or more capitals is an acronym the author meant: "URL",
            // "XML", and the "OS" inside "iOS". Lowercasing it would destroy the word.
            if (/[A-Z]{2,}/.test(word)) {
                return word;
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');

    return result;
}

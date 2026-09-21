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
 * convertKeyToText('apiURL') // 'Api URL'
 * convertKeyToText('order2Status') // 'Order 2 Status'
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
        // Handle digit boundaries: order2Status -> order 2 Status. Without this
        // the whole run stays one word and its inner capital is lowercased away.
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2')
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

/**
 * Lightweight HTTP client using native fetch.
 * Drop-in replacement for the axios subset used by this library.
 */

export class HttpError extends Error {
    status?: number;
    code?: string;

    constructor(message: string, status?: number, code?: string) {
        super(message);
        this.name = 'HttpError';

        // Assigned only when known: an error carrying no transport status or code has no
        // such property, rather than one holding `undefined`.
        if (status !== undefined) {
            this.status = status;
        }
        if (code !== undefined) {
            this.code = code;
        }
    }
}

export interface HttpResponse<T = unknown> {
    data: T;
    status: number;
}

export interface HttpRequestOptions {
    headers?: Record<string, string>;
    timeout?: number;
    /** Number of retry attempts for retryable errors (default: 2) */
    retries?: number;
}

export function isHttpError(error: unknown): error is HttpError {
    return error instanceof HttpError;
}

/**
 * Translate an HTTP failure into a short, provider-agnostic message.
 *
 * Deliberately drops the request URL and body so that API keys embedded in
 * either can never reach a log or an error message.
 *
 * @param error - The failed request
 * @param providerName - Human-readable provider name, used in connection errors
 * @param statusMessages - Provider-specific overrides keyed by HTTP status code
 * @returns A sanitized, user-safe description of the failure
 */
export function describeHttpError(
    error: HttpError,
    providerName: string,
    statusMessages: Readonly<Record<number, string>> = {}
): string {
    const status = error.status;

    if (status !== undefined && statusMessages[status]) {
        return statusMessages[status];
    }
    if (status === 401 || status === 403) {
        return 'Authentication failed - check your API key';
    }
    // 529 is not a standard code, but every provider that returns it means
    // "overloaded, resend later" — DeepL's OpenAPI spec maps it to the same
    // response as 429. It is already in the retry set for that reason, so
    // describing it as an unknown failure would contradict how it is handled.
    if (status === 429 || status === 529) {
        return 'Rate limit exceeded';
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return `Unable to connect to ${providerName}`;
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return 'Request timed out';
    }
    return `Request failed with status ${status ?? 'unknown'}`;
}

// 529 sits with 429 deliberately: it is not a standard code, but every provider
// that returns it means "overloaded, resend later" — DeepL maps it to the same
// rate-limit response as 429.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);

function isRetryable(error: unknown): boolean {
    if (error instanceof HttpError) {
        if (error.status && RETRYABLE_STATUS_CODES.has(error.status)) return true;
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') return true;
    }
    return false;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exported as an object so consumers and tests can spy on `http.post`.
 */
export const http = {
    async post<T = unknown>(url: string, data: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
        const maxAttempts = (options?.retries ?? 2) + 1;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await httpPostOnce<T>(url, data, options);
            } catch (error) {
                lastError = error;
                if (attempt < maxAttempts && isRetryable(error)) {
                    const backoff = Math.min(1000 * 2 ** (attempt - 1), 5000);
                    await delay(backoff);
                    continue;
                }
                throw error;
            }
        }

        throw lastError;
    },
};

async function httpPostOnce<T>(url: string, data: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeout) {
        timeoutId = setTimeout(() => controller.abort(), options.timeout);
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
            body: JSON.stringify(data),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new HttpError(`Request failed with status ${response.status}`, response.status);
        }

        const responseData = (await response.json()) as T;
        return { data: responseData, status: response.status };
    } catch (error) {
        if (error instanceof HttpError) throw error;

        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new HttpError('Request timed out', undefined, 'ETIMEDOUT');
        }

        if (error instanceof TypeError) {
            throw new HttpError('Network error', undefined, 'ECONNREFUSED');
        }

        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

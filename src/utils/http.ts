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
        this.status = status;
        this.code = code;
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

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

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

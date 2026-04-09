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
}

export function isHttpError(error: unknown): error is HttpError {
    return error instanceof HttpError;
}

/**
 * Exported as an object so consumers and tests can spy on `http.post`.
 */
export const http = {
    async post<T = unknown>(url: string, data: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
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
    },
};

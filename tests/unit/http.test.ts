import { describe, it, expect, vi, afterEach } from 'vitest';
import { describeHttpError, HttpError, isHttpError, http } from '@/utils/http';

describe('HttpError', () => {
    it('should create error with message, status, and code', () => {
        const error = new HttpError('Request failed', 404, 'NOT_FOUND');
        expect(error.message).toBe('Request failed');
        expect(error.status).toBe(404);
        expect(error.code).toBe('NOT_FOUND');
        expect(error.name).toBe('HttpError');
    });

    it('should be an instance of Error', () => {
        const error = new HttpError('fail');
        expect(error).toBeInstanceOf(Error);
    });
});

describe('isHttpError', () => {
    it('should return true for HttpError instances', () => {
        expect(isHttpError(new HttpError('fail', 500))).toBe(true);
    });

    it('should return false for regular Error instances', () => {
        expect(isHttpError(new Error('fail'))).toBe(false);
    });

    it('should return false for non-error values', () => {
        expect(isHttpError('string')).toBe(false);
        expect(isHttpError(null)).toBe(false);
        expect(isHttpError(undefined)).toBe(false);
    });
});

describe('http.post', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return parsed JSON data and status on success', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
        );

        const response = await http.post('https://api.example.com/data', { key: 'value' });
        expect(response.data).toEqual({ result: 'ok' });
        expect(response.status).toBe(200);
    });

    it('should send correct method, headers, and JSON body', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

        await http.post('https://api.example.com/data', { foo: 'bar' });

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://api.example.com/data');
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ foo: 'bar' }));
        expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('should merge custom headers with Content-Type', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

        await http.post(
            'https://api.example.com/data',
            {},
            {
                headers: { Authorization: 'Bearer token123' },
            }
        );

        const [, init] = fetchSpy.mock.calls[0];
        const headers = init?.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Authorization']).toBe('Bearer token123');
    });

    it('should throw HttpError with status code for non-ok response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

        await expect(http.post('https://api.example.com/data', {}, { retries: 0 })).rejects.toThrow(HttpError);
        await expect(http.post('https://api.example.com/data', {}, { retries: 0 })).rejects.toMatchObject({
            status: 404,
            message: 'Request failed with status 404',
        });
    });

    it('should throw HttpError with code ECONNREFUSED for TypeError', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

        await expect(http.post('https://api.example.com/data', {}, { retries: 0 })).rejects.toThrow(HttpError);
        await expect(http.post('https://api.example.com/data', {}, { retries: 0 })).rejects.toMatchObject({
            code: 'ECONNREFUSED',
            message: 'Network error',
        });
    });

    it('should throw HttpError with code ETIMEDOUT for AbortError', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'));

        await expect(http.post('https://api.example.com/data', {}, { retries: 0 })).rejects.toThrow(HttpError);
        await expect(http.post('https://api.example.com/data', {}, { retries: 0 })).rejects.toMatchObject({
            code: 'ETIMEDOUT',
            message: 'Request timed out',
        });
    });

    it('should rethrow non-matching errors as-is', async () => {
        const customError = new RangeError('unexpected');
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(customError);

        await expect(http.post('https://api.example.com/data', {}, { retries: 0 })).rejects.toThrow(customError);
    });

    it('should retry on retryable status codes and succeed', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response('', { status: 429 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const response = await http.post('https://api.example.com/data', {}, { retries: 1 });

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(response.data).toEqual({ ok: true });
    });

    it('should retry on network errors and succeed', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const response = await http.post('https://api.example.com/data', {}, { retries: 1 });

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(response.data).toEqual({ ok: true });
    });

    it('should not retry on non-retryable status codes', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));

        await expect(http.post('https://api.example.com/data', {}, { retries: 2 })).rejects.toMatchObject({
            status: 401,
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and throw last error', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));

        await expect(http.post('https://api.example.com/data', {}, { retries: 2 })).rejects.toMatchObject({
            status: 503,
        });

        expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should default to 2 retries', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));

        await expect(http.post('https://api.example.com/data', {})).rejects.toMatchObject({
            status: 500,
        });

        expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 initial + 2 default retries
    });

    it('should retry a timed-out request', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const response = await http.post('https://api.example.com/data', {}, { retries: 1 });

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(response.data).toEqual({ ok: true });
    });

    it('should not cancel the request when no timeout is configured', async () => {
        let capturedSignal: AbortSignal | undefined;
        vi.spyOn(globalThis, 'fetch').mockImplementation((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
            capturedSignal = init?.signal ?? undefined;
            return new Promise((resolve: (value: Response) => void) => {
                setTimeout(() => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })), 30);
            });
        });

        const response = await http.post('https://api.example.com/data', {});

        expect(response.data).toEqual({ ok: true });
        expect(capturedSignal?.aborted).toBe(false);
    });
});

describe('describeHttpError', () => {
    it('should prefer a provider-specific message for a known status', () => {
        const message = describeHttpError(new HttpError('Quota', 456), 'DeepL API', { 456: 'Quota exceeded' });
        expect(message).toBe('Quota exceeded');
    });

    it('should fall back to the generic message when the status is unknown', () => {
        const message = describeHttpError(new HttpError('Teapot', 418), 'DeepL API', { 456: 'Quota exceeded' });
        expect(message).toBe('Request failed with status 418');
    });

    it('should describe an error that carries neither status nor a known code', () => {
        const message = describeHttpError(new HttpError('Something broke'), 'DeepL API');
        expect(message).toBe('Request failed with status unknown');
    });

    it('should never leak the original error text', () => {
        const message = describeHttpError(new HttpError('auth_key=secret rejected', 401), 'DeepL API');
        expect(message).toBe('Authentication failed - check your API key');
        expect(message).not.toContain('secret');
    });
});

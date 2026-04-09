import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpError, isHttpError, http } from '@/utils/http';

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
            new Response(JSON.stringify({ result: 'ok' }), { status: 200 }),
        );

        const response = await http.post('https://api.example.com/data', { key: 'value' });
        expect(response.data).toEqual({ result: 'ok' });
        expect(response.status).toBe(200);
    });

    it('should send correct method, headers, and JSON body', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({}), { status: 200 }),
        );

        await http.post('https://api.example.com/data', { foo: 'bar' });

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://api.example.com/data');
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ foo: 'bar' }));
        expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('should merge custom headers with Content-Type', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({}), { status: 200 }),
        );

        await http.post('https://api.example.com/data', {}, {
            headers: { Authorization: 'Bearer token123' },
        });

        const [, init] = fetchSpy.mock.calls[0];
        const headers = init?.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Authorization']).toBe('Bearer token123');
    });

    it('should throw HttpError with status code for non-ok response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('Not Found', { status: 404 }),
        );

        await expect(http.post('https://api.example.com/data', {})).rejects.toThrow(HttpError);
        await expect(http.post('https://api.example.com/data', {})).rejects.toMatchObject({
            status: 404,
            message: 'Request failed with status 404',
        });
    });

    it('should throw HttpError with code ECONNREFUSED for TypeError', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

        await expect(http.post('https://api.example.com/data', {})).rejects.toThrow(HttpError);
        await expect(http.post('https://api.example.com/data', {})).rejects.toMatchObject({
            code: 'ECONNREFUSED',
            message: 'Network error',
        });
    });

    it('should throw HttpError with code ETIMEDOUT for AbortError', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'));

        await expect(http.post('https://api.example.com/data', {})).rejects.toThrow(HttpError);
        await expect(http.post('https://api.example.com/data', {})).rejects.toMatchObject({
            code: 'ETIMEDOUT',
            message: 'Request timed out',
        });
    });

    it('should rethrow non-matching errors as-is', async () => {
        const customError = new RangeError('unexpected');
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(customError);

        await expect(http.post('https://api.example.com/data', {})).rejects.toThrow(customError);
    });
});

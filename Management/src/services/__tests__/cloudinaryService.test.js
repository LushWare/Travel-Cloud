import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

import { deleteImage, deleteMultipleImages } from '../cloudinaryService';

describe('cloudinaryService.deleteImage', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('calls DELETE on /upload/:publicId with the publicId as a path segment', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await deleteImage('travel-crm/packages/abc 123');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/upload/travel-crm%2Fpackages%2Fabc%20123');
    expect(url).not.toContain('?publicId=');
    expect(options.method).toBe('DELETE');
  });

  it('authenticates with the login cookie instead of a stored token', async () => {
    localStorage.setItem('token', 'leftover-token');
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    await deleteImage('abc');

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.credentials).toBe('include');
    expect(options.headers?.Authorization).toBeUndefined();
  });

  it('throws with the server message when the request fails', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Image not found' }),
    });

    await expect(deleteImage('missing')).rejects.toThrow('Image not found');
  });
});

describe('cloudinaryService.deleteMultipleImages', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('posts the publicIds array to /upload/delete-multiple', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await deleteMultipleImages(['a', 'b']);

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/upload/delete-multiple');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ publicIds: ['a', 'b'] });
  });
});

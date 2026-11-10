import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, SESSION_EXPIRED_EVENT, authFetch, installAxiosAuth, refreshSession } from '../authFetch';

const response = (status, body = {}) => ({ ok: status < 400, status, json: async () => body });
const refreshOk = response(200, { data: { user: { id: 'user-1' } } });
const isRefresh = (url) => url === `${API_BASE_URL}/auth/refresh`;

let expired;
const onExpired = () => { expired += 1; };

beforeEach(() => {
  expired = 0;
  globalThis.fetch = vi.fn();
  window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
});

afterEach(() => {
  window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
});

describe('authFetch', () => {
  it('sends the login cookie to our API', async () => {
    fetch.mockResolvedValue(response(200));

    await authFetch(`${API_BASE_URL}/leads`, { method: 'GET' });

    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/leads`, { method: 'GET', credentials: 'include' });
  });

  it('does not send the login cookie to other sites', async () => {
    fetch.mockResolvedValue(response(200));

    await authFetch('https://res.cloudinary.com/demo/file.pdf');

    expect(fetch.mock.calls[0][1]).toEqual({});
  });

  it('renews the login and retries once after a 401', async () => {
    fetch.mockImplementation(async (url) => {
      if (isRefresh(url)) return refreshOk;
      return fetch.mock.calls.filter(([u]) => u === url).length === 1 ? response(401) : response(200, { ok: 1 });
    });

    const res = await authFetch(`${API_BASE_URL}/leads`);

    expect(res.status).toBe(200);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${API_BASE_URL}/leads`, `${API_BASE_URL}/auth/refresh`, `${API_BASE_URL}/leads`]);
  });

  it('returns the 401 and announces the expired session when renewal fails', async () => {
    fetch.mockImplementation(async (url) => (isRefresh(url) ? response(401) : response(401)));

    const res = await authFetch(`${API_BASE_URL}/leads`);

    expect(res.status).toBe(401);
    expect(expired).toBe(1);
  });

  it('does not try to renew after a failed login attempt', async () => {
    fetch.mockResolvedValue(response(401));

    await authFetch(`${API_BASE_URL}/auth/login`, { method: 'POST' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(expired).toBe(0);
  });

  it('shares one renewal between requests that expire at the same time', async () => {
    const seen = new Map();
    fetch.mockImplementation(async (url) => {
      if (isRefresh(url)) return refreshOk;
      seen.set(url, (seen.get(url) || 0) + 1);
      return seen.get(url) === 1 ? response(401) : response(200);
    });

    await Promise.all([authFetch(`${API_BASE_URL}/a`), authFetch(`${API_BASE_URL}/b`), authFetch(`${API_BASE_URL}/c`)]);

    expect(fetch.mock.calls.filter(([url]) => isRefresh(url))).toHaveLength(1);
  });
});

describe('refreshSession', () => {
  it('posts to the refresh endpoint with the cookie', async () => {
    fetch.mockResolvedValue(refreshOk);

    await refreshSession();

    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  });

  it('resolves to the user returned by the server', async () => {
    fetch.mockResolvedValue(refreshOk);

    expect(await refreshSession()).toEqual({ id: 'user-1' });
  });

  it('resolves to null when the network fails', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await refreshSession()).toBeNull();
  });
});

describe('installAxiosAuth', () => {
  const makeAxios = () => {
    const instance = vi.fn();
    instance.defaults = {};
    instance.interceptors = { response: { use: vi.fn() } };
    installAxiosAuth(instance);
    return { instance, onError: instance.interceptors.response.use.mock.calls[0][1] };
  };
  const unauthorized = (config) => Object.assign(new Error('401'), { config, response: { status: 401 } });

  it('sends the login cookie with every request', () => {
    const { instance } = makeAxios();

    expect(instance.defaults.withCredentials).toBe(true);
  });

  it('retries the original request after renewing the login', async () => {
    const { instance, onError } = makeAxios();
    fetch.mockResolvedValue(refreshOk);
    instance.mockResolvedValue({ data: 'ok' });
    const config = { url: `${API_BASE_URL}/leads` };

    expect(await onError(unauthorized(config))).toEqual({ data: 'ok' });
    expect(instance).toHaveBeenCalledWith(config);
  });

  it('gives up on a request that already failed once after renewal', async () => {
    const { onError } = makeAxios();
    const error = unauthorized({ url: `${API_BASE_URL}/leads`, _authRetried: true });

    await expect(onError(error)).rejects.toBe(error);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes through errors other than 401', async () => {
    const { onError } = makeAxios();
    const error = Object.assign(new Error('500'), { config: {}, response: { status: 500 } });

    await expect(onError(error)).rejects.toBe(error);
  });
});

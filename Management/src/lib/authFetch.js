export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.lushtravelcloud.com/api/v1';

export const SESSION_EXPIRED_EVENT = 'auth:session-expired';

const NO_REFRESH = /\/auth\/(login|login-step[12]|resend-otp|refresh|logout|forgot-password|reset-temp-password)\b/;

let pendingRefresh = null;

/** Renews the login cookies once, shared by every caller waiting on it. Resolves to the user or null. */
export function refreshSession() {
  pendingRefresh ??= fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => (res.ok ? (await res.json())?.data?.user ?? null : null))
    .catch(() => null)
    .finally(() => {
      pendingRefresh = null;
    });
  return pendingRefresh;
}

const sessionExpired = () => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));

const isOurApi = (url) => url.startsWith(API_BASE_URL) || url.startsWith('/');

/** fetch() that sends the login cookie to our API and retries once after renewing an expired login. */
export async function authFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url;
  if (!isOurApi(url)) return fetch(input, init);

  const send = () => fetch(input, { ...init, credentials: 'include' });
  const response = await send();
  if (response.status !== 401 || NO_REFRESH.test(url)) return response;

  if (!(await refreshSession())) {
    sessionExpired();
    return response;
  }
  return send();
}

export function installAxiosAuth(axios) {
  axios.defaults.withCredentials = true;
  axios.interceptors.response.use(undefined, async (error) => {
    const config = error.config;
    if (error.response?.status !== 401 || !config || config._authRetried || NO_REFRESH.test(config.url || '')) {
      throw error;
    }
    config._authRetried = true;
    if (!(await refreshSession())) {
      sessionExpired();
      throw error;
    }
    return axios(config);
  });
}

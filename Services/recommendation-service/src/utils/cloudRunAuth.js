import { GoogleAuth } from 'google-auth-library';

const googleAuth = new GoogleAuth();
const clients = new Map();

export async function domainAuthHeader(baseUrl) {
  if (!process.env.K_SERVICE) return {};
  if (!clients.has(baseUrl)) clients.set(baseUrl, await googleAuth.getIdTokenClient(baseUrl));
  const headers = await clients.get(baseUrl).getRequestHeaders(baseUrl);
  const authorization = typeof headers?.get === 'function'
    ? headers.get('authorization')
    : headers?.Authorization;
  if (!authorization) throw new Error('Could not authenticate the analytics-service request');
  return { Authorization: authorization };
}
export async function getCloudRunAuthorization(url) {
  if (!process.env.K_SERVICE) return {};
  const metadataUrl = new URL('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity');
  metadataUrl.searchParams.set('audience', url);
  metadataUrl.searchParams.set('format', 'full');
  const response = await fetch(metadataUrl, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Could not authenticate to backend service (status ${response.status})`);
  return { authorization: `Bearer ${await response.text()}` };
}
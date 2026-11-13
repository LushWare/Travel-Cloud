import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, Loader2, PlugZap, RotateCw, Trash2 } from 'lucide-react';
import toast from '@/lib/toast';
import { integrationAPI } from '../services/api';
import { Button } from '@/components/ui/button';

type GoogleAdsStatus = {
  connected: boolean;
  status?: string;
  webhookUrl: string;
  lastTestedAt?: string | null;
};

export default function GoogleAdsIntegrationSettings() {
  const [status, setStatus] = useState<GoogleAdsStatus | null>(null);
  const [webhookKey, setWebhookKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = async () => {
    const response = await integrationAPI.getGoogleAds();
    setStatus(response.data as GoogleAdsStatus);
  };

  useEffect(() => {
    loadStatus()
      .catch((error) => toast.error(error?.message || 'Could not load Google Ads setup'))
      .finally(() => setLoading(false));
  }, []);

  const generateKey = async () => {
    if (status?.connected && !window.confirm('Generate a new key? The current key will stop working until you update it in Google Ads.')) return;
    setSaving(true);
    try {
      const response = await integrationAPI.saveGoogleAds();
      const data = response.data as GoogleAdsStatus & { webhookKey: string };
      setStatus(data);
      setWebhookKey(data.webhookKey);
      toast.success(status?.connected ? 'Webhook key rotated' : 'Google Ads setup created');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not create Google Ads setup');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy the ${label.toLowerCase()}`);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Ads? New leads from this webhook will be rejected.')) return;
    setDisconnecting(true);
    try {
      const response = await integrationAPI.disconnectGoogleAds();
      setStatus(response.data as GoogleAdsStatus);
      setWebhookKey(null);
      toast.success('Google Ads disconnected');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not disconnect Google Ads');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="google-ads-heading">
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <PlugZap className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="google-ads-heading" className="font-semibold text-foreground">Google Ads leads</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Send lead-form submissions directly to this agency&apos;s CRM.
            </p>
          </div>
          {status?.connected && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Setup created
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading Google Ads setup" />
        ) : (
          <>
            <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              {status?.lastTestedAt
                ? `A Google Ads webhook was received ${new Date(status.lastTestedAt).toLocaleString()}.`
                : status?.connected
                  ? 'Setup is ready. Add the webhook details to your Google Ads lead form, then send a test lead.'
                  : 'Create a secure webhook key, then add the details to your Google Ads lead form.'}
            </div>

            {status?.connected && (
              <div className="space-y-3 rounded-md border border-border p-4">
                <div>
                  <p className="mb-1.5 text-sm font-medium">Webhook URL</p>
                  <div className="flex gap-2">
                    <code className="min-w-0 flex-1 break-all rounded bg-muted px-3 py-2 text-xs">{status.webhookUrl}</code>
                    <Button type="button" size="icon" variant="outline" aria-label="Copy webhook URL" title="Copy webhook URL" onClick={() => copy(status.webhookUrl, 'Webhook URL')}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {webhookKey && (
                  <div>
                    <p className="mb-1.5 text-sm font-medium">Webhook key <span className="font-normal text-muted-foreground">shown only now</span></p>
                    <div className="flex gap-2">
                      <code className="min-w-0 flex-1 break-all rounded bg-muted px-3 py-2 text-xs">{webhookKey}</code>
                      <Button type="button" size="icon" variant="outline" aria-label="Copy webhook key" title="Copy webhook key" onClick={() => copy(webhookKey, 'Webhook key')}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>In Google Ads, open the lead form asset and choose its webhook integration settings.</li>
                  <li>Paste the URL and key above, then save the lead form.</li>
                  <li>Use Google Ads&apos; test option to send a test lead. It should appear in this agency&apos;s CRM.</li>
                </ol>
                <p className="text-xs text-muted-foreground">
                  The key is not shown again. If you lose it, generate a new key and replace the old one in Google Ads.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={generateKey} disabled={saving || disconnecting} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : status?.connected ? <RotateCw className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                {saving ? 'Generating…' : status?.connected ? 'Rotate webhook key' : 'Set up Google Ads'}
              </Button>
              {status?.connected && (
                <Button type="button" variant="outline" onClick={disconnect} disabled={disconnecting || saving} className="gap-2 text-destructive">
                  {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Disconnect
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

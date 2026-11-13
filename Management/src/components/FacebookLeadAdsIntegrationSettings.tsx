import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, Trash2 } from 'lucide-react';
import toast from '@/lib/toast';
import { integrationAPI } from '../services/api';
import { Button } from '@/components/ui/button';

type FacebookPage = { id: string; name: string; selected: boolean };
type FacebookStatus = {
  connected: boolean;
  status?: string;
  webhookUrl: string;
  pages: FacebookPage[];
  lastTestedAt?: string | null;
};

function consumeOAuthResult() {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('facebook');
  if (!result) return;
  if (result === 'connected') toast.success('Facebook authorized. Select the pages that should send leads.');
  else if (result === 'cancelled') toast.error('Facebook authorization was cancelled.');
  else if (result === 'no-pages') toast.error('No Facebook Pages were available for this account.');
  else toast.error('Facebook authorization could not be completed. Try connecting again.');
  url.searchParams.delete('facebook');
  window.history.replaceState({}, '', url.toString());
}

export default function FacebookLeadAdsIntegrationSettings() {
  const [status, setStatus] = useState<FacebookStatus | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = async () => {
    const response = await integrationAPI.getFacebook();
    const next = response.data as FacebookStatus;
    setStatus(next);
    setSelectedPageIds(next.pages.filter((page) => page.selected).map((page) => page.id));
  };

  useEffect(() => {
    consumeOAuthResult();
    loadStatus()
      .catch((error) => toast.error(error?.message || 'Could not load Facebook setup'))
      .finally(() => setLoading(false));
  }, []);

  const connect = async () => {
    const authorizationWindow = window.open('about:blank', '_blank');
    if (!authorizationWindow) {
      toast.error('Allow pop-ups to connect Facebook');
      return;
    }
    authorizationWindow.opener = null;
    setConnecting(true);
    try {
      const response = await integrationAPI.startFacebookConnect();
      const authorizationUrl = (response.data as { authorizationUrl?: string }).authorizationUrl;
      if (!authorizationUrl || !authorizationUrl.startsWith('https://www.facebook.com/')) {
        throw new Error('Facebook returned an invalid authorization URL');
      }
      authorizationWindow.location.replace(authorizationUrl);
    } catch (error) {
      authorizationWindow.close();
      toast.error((error as Error)?.message || 'Could not start Facebook authorization');
      setConnecting(false);
    }
  };

  const togglePage = (pageId: string) => {
    setSelectedPageIds((current) =>
      current.includes(pageId) ? current.filter((id) => id !== pageId) : [...current, pageId]
    );
  };

  const savePages = async () => {
    setSaving(true);
    try {
      const response = await integrationAPI.saveFacebookPages(selectedPageIds);
      setStatus(response.data as FacebookStatus);
      toast.success('Facebook Lead Ads pages connected');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not connect the selected pages');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Facebook Lead Ads? New leads from its pages will no longer be received.')) return;
    setDisconnecting(true);
    try {
      const response = await integrationAPI.disconnectFacebook();
      setStatus(response.data as FacebookStatus);
      setSelectedPageIds([]);
      toast.success('Facebook Lead Ads disconnected');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not disconnect Facebook');
    } finally {
      setDisconnecting(false);
    }
  };

  const hasPages = Boolean(status?.pages.length);
  const readyToSelect = status?.status === 'pending' || status?.connected;

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="facebook-lead-ads-heading">
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <PlugZap className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="facebook-lead-ads-heading" className="font-semibold text-foreground">Facebook Lead Ads</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect Facebook Pages and choose which ones may send leads to this agency.
            </p>
          </div>
          {status?.connected && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Connected
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading Facebook setup" />
        ) : (
          <>
            <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              {status?.connected
                ? 'Selected Pages are connected. New Lead Ads submissions will be added to this agency.'
                : readyToSelect
                  ? 'Choose the Pages whose Lead Ads should enter this agency’s CRM.'
                  : 'Authorize Facebook to choose which Pages can send leads to this agency.'}
            </p>

            {hasPages && (
              <fieldset className="space-y-2 rounded-md border border-border p-4" disabled={saving || disconnecting}>
                <legend className="px-1 text-sm font-medium">Facebook Pages</legend>
                {status?.pages.map((page) => (
                  <label key={page.id} className="flex items-center gap-3 rounded px-2 py-2 text-sm hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={selectedPageIds.includes(page.id)}
                      onChange={() => togglePage(page.id)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span className="min-w-0 flex-1 truncate">{page.name}</span>
                    <span className="text-xs text-muted-foreground">Page {page.id}</span>
                  </label>
                ))}
              </fieldset>
            )}

            {status?.connected && (
              <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                Meta webhook endpoint: <code className="break-all">{status.webhookUrl}</code>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={connect} disabled={connecting || saving || disconnecting} className="gap-2">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                {connecting ? 'Opening Facebook…' : readyToSelect ? 'Reconnect Facebook' : 'Connect Facebook'}
              </Button>
              {readyToSelect && (
                <Button type="button" variant="outline" onClick={savePages} disabled={!selectedPageIds.length || saving || connecting || disconnecting}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {saving ? 'Saving pages…' : 'Save selected pages'}
                </Button>
              )}
              {readyToSelect && (
                <Button type="button" variant="outline" onClick={disconnect} disabled={disconnecting || saving || connecting} className="gap-2 text-destructive">
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

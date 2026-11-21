import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Hotel, Loader2, PlugZap, Trash2 } from 'lucide-react';
import toast from '@/lib/toast';
import { integrationAPI } from '../services/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type LiteApiStatus = {
  connected: boolean;
  status?: string;
  mode?: 'test' | 'live' | null;
  lastFour?: string | null;
  lastTestedAt?: string | null;
  lastError?: string | null;
};

const KEY_PATTERN = '^(sand|prod)_[A-Za-z0-9\\-]{8,200}$';

/** Settings > Integrations: the agency's own LiteAPI account, used for every hotel search and booking. */
export default function LiteApiIntegrationSettings() {
  const [status, setStatus] = useState<LiteApiStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await integrationAPI.getLiteApi();
    setStatus(response.data as LiteApiStatus);
  }, []);

  useEffect(() => {
    loadStatus()
      .catch((error) => toast.error(apiErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [loadStatus]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await integrationAPI.saveLiteApi({ apiKey: apiKey.trim() });
      setStatus(response.data as LiteApiStatus);
      setApiKey('');
      toast.success('LiteAPI account connected');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await integrationAPI.testLiteApi();
      toast.success('LiteAPI connection is working');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      await loadStatus().catch(() => {});
      setTesting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const response = await integrationAPI.disconnectLiteApi();
      setStatus(response.data as LiteApiStatus);
      toast.success('LiteAPI disconnected');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = status?.connected === true;

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="agency-liteapi-heading">
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <Hotel className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h2 id="agency-liteapi-heading" className="font-semibold text-foreground">Hotels (LiteAPI)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search and book hotels with your agency&apos;s own LiteAPI account. Bookings are paid by your LiteAPI account.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading LiteAPI connection" />
        ) : (
          <>
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground" data-testid="liteapi-status">
              {connected
                ? `Connected: ${status?.mode === 'live' ? 'live' : 'sandbox'} account, key ending ${status?.lastFour}. The key is encrypted and never shown here.`
                : status?.status === 'error'
                  ? 'LiteAPI stopped accepting the saved key. Paste a new one to resume hotel search and booking.'
                  : 'Not connected. Hotel search and booking stay off until you connect your LiteAPI account.'}
            </div>

            {connected && status?.mode === 'test' && (
              <p className="text-sm text-muted-foreground">
                This is a sandbox key: bookings are not real reservations. Paste a production key when you are ready to sell.
              </p>
            )}

            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1.5 text-sm">
                <label htmlFor="liteapi-api-key" className="block font-medium">
                  {connected ? 'Replace API key' : 'LiteAPI key'}
                </label>
                <Input
                  id="liteapi-api-key"
                  required
                  type="password"
                  autoComplete="off"
                  pattern={KEY_PATTERN}
                  title="Starts with sand_ or prod_"
                  aria-describedby="liteapi-api-key-help"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value.trim())}
                  placeholder="prod_…"
                />
                <p id="liteapi-api-key-help" className="text-xs text-muted-foreground">
                  In your LiteAPI dashboard: API Keys. Copy the sandbox or production key and paste it here.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving || !apiKey.trim()} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  {saving ? 'Checking and saving…' : connected ? 'Replace key' : 'Test and connect'}
                </Button>
                {(connected || status?.status === 'error') && (
                  <>
                    <Button type="button" variant="outline" onClick={test} disabled={testing || saving}>
                      {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Test saved connection
                    </Button>
                    <Button type="button" variant="outline" onClick={disconnect} disabled={disconnecting || saving} className="text-destructive">
                      {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      Disconnect
                    </Button>
                  </>
                )}
              </div>
            </form>

            {status?.lastTestedAt && (
              <p className="text-xs text-muted-foreground">
                Last checked {new Date(status.lastTestedAt).toLocaleString()}
                {status.lastError ? ` · ${status.lastError}` : ''}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
